// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct, Aws } from '@aws-cdk/core';
import { IRole } from '@aws-cdk/aws-iam';
import { CallAwsService } from '@aws-cdk/aws-stepfunctions-tasks';
import { StateMachine, JsonPath, Map, Choice, Condition, Pass, Result } from '@aws-cdk/aws-stepfunctions';
import { CfnEventBusPolicy, Rule, EventBus } from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';


/**
 * Properties for the ProducerWorkflow Construct
 */
export interface ProducerWorkflowProps {
    /**
    * Central data mesh account Id
    */
    readonly centralAccId: string;

    /**
    * Lake Formation admin role
    */
    readonly lfAdminRole: IRole;
}

/**
 * ProducerWorkflow Construct to create a workflow for Producer account.
 * The workflow is a Step Functions state machine that is invoked from the central data mesh account via EventBridge bus.
 * It checks and accepts pending RAM shares (tables), and creates resource links in LF Catalog. 
 */
export class ProducerWorkflow extends Construct {
    /**
     * Construct a new instance of ProducerWorkflow.
     * @param {Construct} scope the Scope of the CDK Construct
     * @param {string} id the ID of the CDK Construct
     * @param {ProducerWorkflowProps} props the ProducerWorkflowProps properties
     * @access public
     */

    constructor(scope: Construct, id: string, props: ProducerWorkflowProps) {
        super(scope, id);

        // Task to check for existing RAM invitations
        const getRamInvitations = new CallAwsService(this, 'GetResourceShareInvitations', {
            service: 'ram',
            action: 'getResourceShareInvitations',
            iamResources: ['*'],
            parameters: {},
            resultPath: "$.taskresult",
        });

        // Task to accept RAM share invitation
        const acceptRamShare = new CallAwsService(this, 'AcceptResourceShareInvitation', {
            service: 'ram',
            action: 'acceptResourceShareInvitation',
            iamResources: ['*'],
            parameters: {
                'ResourceShareInvitationArn.$': '$.ram_share.ResourceShareInvitationArn',
            },
            resultPath: "$.Response",
            resultSelector: {
                'Status.$': '$.ResourceShareInvitation.Status',
            },
        });

        // Task to create resource-link for a shared table from central accunt
        const createResourceLink = new CallAwsService(this, 'createResourceLink', {
            service: 'glue',
            action: 'createTable',
            iamResources: ['*'],
            parameters: {
                'DatabaseName.$': '$.database_name',
                'TableInput': {
                    'Name.$': "States.Format('rl-{}', $.table_name)",
                    'TargetTable': {
                        'CatalogId': props.centralAccId,
                        'DatabaseName.$': '$.central_database_name',
                        'Name.$': '$.table_name',
                    },
                },
            },
            resultPath: JsonPath.DISCARD,
        });

        // Pass task to finish the workflow if no PENDING invites
        const finishWorkflow = new Pass(this, 'finishWorkflow');

        // Task to iterate over RAM shares and check if there are PENDING invites from the central account
        const ramMapTask = new Map(this, 'forEachRamInvitation', {
            itemsPath: '$.taskresult.ResourceShareInvitations',
            parameters: {
                'ram_share.$': '$$.Map.Item.Value',
                'central_account_id.$': '$.central_account_id',
                'central_database_name.$': '$.central_database_name',
                'database_name.$': '$.database_name',
                'table_name.$': '$.table_name'
            },
            resultPath: '$.map_result',
            outputPath: '$.map_result.[?(@.central_account_id)]',
        });

        ramMapTask.iterator(new Choice(this, 'isInvitationPending')
            .when(Condition.and(
                Condition.stringEqualsJsonPath('$.ram_share.SenderAccountId', '$.central_account_id'),
                Condition.stringEquals('$.ram_share.Status', 'PENDING')
            ), acceptRamShare)
            .otherwise(new Pass(this, "notPendingPass", { result: Result.fromObject({}) })));

        ramMapTask.next(new Choice(this, 'shareAccepted', { outputPath: '$[0]' })
            .when(Condition.and(Condition.isPresent('$[0]'),
                Condition.stringEquals('$[0].Response.Status', 'ACCEPTED')),
                createResourceLink
            ).otherwise(finishWorkflow))

        // State Machine workflow to accept RAM share and create resource-link for a shared table
        const crossAccStateMachine = new StateMachine(this, 'CrossAccStateMachine', {
            definition: getRamInvitations.next(new Choice(this, "resourceShareInvitationsEmpty")
                .when(Condition.isPresent('$.taskresult.ResourceShareInvitations[0]'), ramMapTask)
                .otherwise(finishWorkflow)
            ),
            role: props.lfAdminRole,
        });

        // Event Bridge event bus for producer account
        const eventBus = new EventBus(this, 'producerEventBus', {
            eventBusName: `${Aws.ACCOUNT_ID}_producerEventBus`,
        });

        // Cross-account policy to allow the central account send events to producer's bus
        const crossAccountBusPolicy = new CfnEventBusPolicy(this, 'crossAccountBusPolicy', {
            eventBusName: eventBus.eventBusName,
            statementId: 'AllowCentralAccountToPutEvents',
            action: 'events:PutEvents',
            principal: props.centralAccId,
        });
        crossAccountBusPolicy.node.addDependency(eventBus);

        // Event Bridge Rule to trigger the this worklfow upon event from the central account
        const rule = new Rule(this, 'producerDataDomainRule', {
            eventPattern: {
                source: ['com.central.stepfunction'],
                account: [props.centralAccId],
                detailType: ["producerCreateResourceLink"],
            },
            eventBus,
        });

        rule.addTarget(new targets.SfnStateMachine(crossAccStateMachine));
        rule.node.addDependency(eventBus)
    }
}
