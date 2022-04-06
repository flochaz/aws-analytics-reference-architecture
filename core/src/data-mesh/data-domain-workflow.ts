// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct, Aws, RemovalPolicy } from '@aws-cdk/core';
import { IRole } from '@aws-cdk/aws-iam';
import { CallAwsService } from '@aws-cdk/aws-stepfunctions-tasks';
import { StateMachine, JsonPath, Map, Choice, Condition, Pass, Result } from '@aws-cdk/aws-stepfunctions';
import { CfnEventBusPolicy, Rule, EventBus } from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';


/**
 * Properties for the DataDomainWorkflow Construct
 */
export interface DataDomainWorkflowProps {
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
 * DataDomainWorkflow Construct to create a workflow for Producer/Consumer account.
 * The workflow is a Step Functions state machine that is invoked from the central data mesh account via EventBridge bus.
 * It checks and accepts pending RAM shares (tables), and creates resource links in LF Catalog. 
 */
export class DataDomainWorkflow extends Construct {
    /**
     * Construct a new instance of DataDomainWorkflow.
     * @param {Construct} scope the Scope of the CDK Construct
     * @param {string} id the ID of the CDK Construct
     * @param {DataDomainWorkflowProps} props the DataDomainWorkflowProps properties
     * @access public
     */

    constructor(scope: Construct, id: string, props: DataDomainWorkflowProps) {
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

        const rlMapTask = new Map(this, 'forEachTable', {
            itemsPath: '$.table_names',
            parameters: {
                'central_database_name.$': '$.central_database_name',
                'database_name.$': '$.database_name',
                'table_name.$': '$$.Map.Item.Value'
            },
            resultPath: JsonPath.DISCARD,
        });
        rlMapTask.iterator(createResourceLink)

        // Pass task to finish the workflow
        const finishWorkflow = new Pass(this, 'finishWorkflow');

        rlMapTask.next(finishWorkflow)

        // Task to iterate over RAM shares and check if there are PENDING invites from the central account
        const ramMapTask = new Map(this, 'forEachRamInvitation', {
            itemsPath: '$.taskresult.ResourceShareInvitations',
            parameters: {
                'ram_share.$': '$$.Map.Item.Value',
                'central_account_id.$': '$.account',
                'central_database_name.$': "States.Format('{}_{}', $.account, $.detail.database_name)",
                'database_name.$': '$.detail.database_name',
                'table_names.$': '$.detail.table_names'
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
                rlMapTask
            ).otherwise(finishWorkflow))

        // State Machine workflow to accept RAM share and create resource-link for a shared table
        const crossAccStateMachine = new StateMachine(this, 'CrossAccStateMachine', {
            definition: getRamInvitations.next(new Choice(this, "resourceShareInvitationsEmpty")
                .when(Condition.isPresent('$.taskresult.ResourceShareInvitations[0]'), ramMapTask)
                .otherwise(finishWorkflow)
            ),
            role: props.lfAdminRole,
        });

        // Event Bridge event bus for data domain account
        const eventBus = new EventBus(this, 'dataDomainEventBus', {
            eventBusName: `${Aws.ACCOUNT_ID}_dataDomainEventBus`,
        });
        eventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);

        // Cross-account policy to allow the central account to send events to data domain's bus
        const crossAccountBusPolicy = new CfnEventBusPolicy(this, 'crossAccountBusPolicy', {
            eventBusName: eventBus.eventBusName,
            statementId: 'AllowCentralAccountToPutEvents',
            action: 'events:PutEvents',
            principal: props.centralAccId,
        });
        crossAccountBusPolicy.node.addDependency(eventBus);

        // Event Bridge Rule to trigger the this worklfow upon event from the central account
        const rule = new Rule(this, 'DataDomainRule', {
            eventPattern: {
                source: ['com.central.stepfunction'],
                account: [props.centralAccId],
                detailType: [`${Aws.ACCOUNT_ID}_createResourceLinks`],
            },
            eventBus,
        });

        rule.applyRemovalPolicy(RemovalPolicy.DESTROY);
        rule.addTarget(new targets.SfnStateMachine(crossAccStateMachine));
        rule.node.addDependency(eventBus)
    }
}
