// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct, Aws } from '@aws-cdk/core';
import { IRole } from '@aws-cdk/aws-iam';
import { CallAwsService, EventBridgePutEvents } from "@aws-cdk/aws-stepfunctions-tasks";
import { StateMachine, JsonPath, TaskInput } from "@aws-cdk/aws-stepfunctions";
import { Rule, EventBus } from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';


/**
 * Properties for the CentralWorkflow Construct
 */

export interface CentralWorkflowProps {
    /**
    * LakeFormation admin role
    */
    readonly lfAdminRole: IRole;

    /**
    * Producer Event Bus Arn
    */
    readonly producerEventBusArn: string;
}

/**
 * CentralWorkflow Construct to create a workflow for Central account.
 */
export class CentralWorkflow extends Construct {
    /**
     * Construct a new instance of CentralWorkflow.
     * @param {Construct} scope the Scope of the CDK Construct
     * @param {string} id the ID of the CDK Construct
     * @param {CentralWorkflowProps} props the CentralWorkflowProps properties
     * @access public
     */

    constructor(scope: Construct, id: string, props: CentralWorkflowProps) {
        super(scope, id);

        // Event Bridge event bus for central account
        const eventBus = new EventBus(this, 'centralEventBus', {
            eventBusName: `${Aws.ACCOUNT_ID}_centralEventBus`,
        });

        // Event Bridge Rule to trigger the this worklfow upon event from the central account
        const rule = new Rule(this, 'producerDataDomainRule', {
            eventPattern: {
                source: ['com.central.stepfunction'],
                detailType: ["producerCreateResourceLink"],
            },
            eventBus,
        });

        rule.addTarget(new targets.EventBus(
            EventBus.fromEventBusArn(
                this,
                'producerBus',
                props.producerEventBusArn,
            )),
        );
        rule.node.addDependency(eventBus)

        // This task registers S3 new s3 location in Lake Formation
        const registerS3Location = new CallAwsService(this, "registerS3Location", {
            service: "lakeformation",
            action: "registerResource",
            iamResources: ["*"],
            parameters: {
                "ResourceArn.$": "States.Format('arn:aws:s3:::{}', $.data_product_s3)",
                "RoleArn": props.lfAdminRole.roleArn,
            },
            resultPath: JsonPath.DISCARD
        });

        // Grant Data Location access to Lake Formation Admin role
        const grantLfAdminAccess = new CallAwsService(this, "grantLfAdminAccess", {
            service: "lakeformation",
            action: "grantPermissions",
            iamResources: ["*"],
            parameters: {
                "Permissions": [
                    "DATA_LOCATION_ACCESS"
                ],
                "Principal": {
                    "DataLakePrincipalIdentifier": props.lfAdminRole.roleArn
                },
                "Resource": {
                    "DataLocation": {
                        "ResourceArn.$": "States.Format('arn:aws:s3:::{}', $.data_product_s3)"
                    }
                }
            },
            resultPath: JsonPath.DISCARD
        });

        // Grant Data Location access to Producer account
        const grantProducerAccess = new CallAwsService(this, "grantProducerAccess", {
            service: "lakeformation",
            action: "grantPermissions",
            iamResources: ["*"],
            parameters: {
                "Permissions": [
                    "DATA_LOCATION_ACCESS"
                ],
                "Principal": {
                    "DataLakePrincipalIdentifier.$": "$.producer_acc_id"
                },
                "Resource": {
                    "DataLocation": {
                        "ResourceArn.$": "States.Format('arn:aws:s3:::{}', $.data_product_s3)"
                    }
                }
            },
            resultPath: JsonPath.DISCARD
        });

        // Task to create resource-link for a shared table from central accunt
        const createDatabase = new CallAwsService(this, 'createDatabase', {
            service: 'glue',
            action: 'createDatabase',
            iamResources: ['*'],
            parameters: {
                'DatabaseInput': {
                    'Name.$': "States.Format('{}_{}', $.producer_acc_id, $.database_name)",
                    'Description': "States.Format('Data product for {} in Producer account {}', $.data_product_s3, $.producer_acc_id)",
                },
            },
            resultPath: JsonPath.DISCARD,
        });

        // Task to create resource-link for a shared table from central accunt
        const createTable = new CallAwsService(this, 'createTable', {
            service: 'glue',
            action: 'createTable',
            iamResources: ['*'],
            parameters: {
                'DatabaseName.$': "States.Format('{}_{}', $.producer_acc_id, $.database_name)",
                'TableInput': {
                    'Name.$': '$.table_name',
                },
            },
            resultPath: JsonPath.DISCARD,
        });

        // Grant SUPER permissions on product database and tables to Producer account
        const grantTablePermissions = new CallAwsService(this, "grantTablePermissionsToProducer", {
            service: "lakeformation",
            action: "grantPermissions",
            iamResources: ["*"],
            parameters: {
                "Permissions": [
                    "ALL"
                ],
                "PermissionsWithGrantOption": [
                    "ALL"
                ],
                "Principal": {
                    "DataLakePrincipalIdentifier.$": "$.producer_acc_id"
                },
                "Resource": {
                    "Table": {
                        "DatabaseName.$": "States.Format('{}_{}', $.producer_acc_id, $.database_name)",
                        "Name.$": "$.table_name",
                    },
                },
            },
            resultPath: JsonPath.DISCARD
        });

        const triggerProducer = new EventBridgePutEvents(this, "TriggerProducer", {
            entries: [{
                detail: TaskInput.fromObject({
                    'database_name': JsonPath.stringAt('$.database_name'),
                    'central_database_name': JsonPath.stringAt('$.database_name'),
                    'central_account_id': JsonPath.stringAt('$.central_account_id'),
                    'table_name': JsonPath.stringAt('$.table_name'),
                }),
                detailType: "producerCreateResourceLink",
                eventBus: eventBus,
                source: 'com.central.stepfunction'
            }]
        });

        grantTablePermissions.next(triggerProducer);

        // State Machine workflow register data product in Central data mesh account
        createTable.addCatch(grantTablePermissions, {
            errors: ["Glue.AlreadyExistsException"], resultPath: "$.Exception"
        }).next(grantTablePermissions)

        createDatabase.addCatch(createTable, {
            errors: ["Glue.AlreadyExistsException"], resultPath: "$.Exception"
        }).next(createTable)

        grantProducerAccess.next(createDatabase)

        grantLfAdminAccess.next(grantProducerAccess);

        registerS3Location.addCatch(grantLfAdminAccess, {
            errors: [
                "LakeFormation.AlreadyExistsException"
            ],
            resultPath: "$.Exception"
        }).next(grantLfAdminAccess);

        new StateMachine(this, 'RegisterDataProduct', {
            definition: registerS3Location,
            role: props.lfAdminRole,
        });
    }
}
