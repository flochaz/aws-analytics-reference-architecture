// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct, Aws, RemovalPolicy } from '@aws-cdk/core';
import { IRole } from '@aws-cdk/aws-iam';
import { CallAwsService, EventBridgePutEvents } from "@aws-cdk/aws-stepfunctions-tasks";
import { StateMachine, JsonPath, TaskInput, Map } from "@aws-cdk/aws-stepfunctions";
import { EventBus } from '@aws-cdk/aws-events';


/**
 * Properties for the CentralGovernanceProps Construct
 */
export interface CentralGovernanceProps {
    /**
    * LakeFormation admin role
    */
    readonly lfAdminRole: IRole;
}

/**
 * CentralGovernance Construct to create a workflow and resources for the Central account.
 */
export class CentralGovernance extends Construct {
    /**
     * Construct a new instance of CentralGovernance.
     * @param {Construct} scope the Scope of the CDK Construct
     * @param {string} id the ID of the CDK Construct
     * @param {CentralGovernanceProps} props the CentralGovernanceProps properties
     * @access public
     */

    constructor(scope: Construct, id: string, props: CentralGovernanceProps) {
        super(scope, id);

        // Event Bridge event bus for central account
        const eventBus = new EventBus(this, 'centralEventBus', {
            eventBusName: `${Aws.ACCOUNT_ID}_centralEventBus`,
        });
        eventBus.applyRemovalPolicy(RemovalPolicy.DESTROY);

        // This task registers new s3 location in Lake Formation
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

        // Grant Data Location access to Data Domain account
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

        // Task to create a database
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

        // Task to create a table
        const createTable = new CallAwsService(this, 'createTable', {
            service: 'glue',
            action: 'createTable',
            iamResources: ['*'],
            parameters: {
                'DatabaseName.$': "States.Format('{}_{}', $.producer_acc_id, $.database_name)",
                'TableInput': {
                    'Name.$': '$.tables.name',
                },
            },
            resultPath: JsonPath.DISCARD,
        });

        // Grant SUPER permissions on product database and tables to Data Domain account
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
                        "Name.$": "$.tables.name",
                    },
                },
            },
            outputPath: "$.tables.name",
            resultPath: JsonPath.DISCARD
        });

        // Trigger workflow in Data Domain account via Event Bridge
        const triggerProducer = new EventBridgePutEvents(this, "triggerCreateResourceLinks", {
            entries: [{
                detail: TaskInput.fromObject({
                    'database_name': JsonPath.stringAt('$.database_name'),
                    'table_names': JsonPath.stringAt('$.map_result.flatten'),
                }),
                detailType: JsonPath.format('{}_createResourceLinks', JsonPath.stringAt('$.producer_acc_id')),
                eventBus: eventBus,
                source: 'com.central.stepfunction'
            }]
        });

        const tablesMapTask = new Map(this, 'forEachTable', {
            itemsPath: '$.tables',
            parameters: {
                'producer_acc_id.$': '$.producer_acc_id',
                'database_name.$': '$.database_name',
                'tables.$': '$$.Map.Item.Value',
            },
            resultSelector: {
                "flatten.$": "$[*]"
            },
            resultPath: "$.map_result",
        });

        const updateDatabaseOwnerMetadata = new CallAwsService(this, "updateDatabaseOwnerMetadata", {
            service: "glue",
            action: "updateDatabase",
            iamResources: ["*"],
            parameters: {
                "Name.$": "States.Format('{}_{}', $.producer_acc_id, $.database_name)",
                "DatabaseInput": {
                    "Name.$": "States.Format('{}_{}', $.producer_acc_id, $.database_name)",
                    "Parameters": {
                        "data_owner.$": "$.producer_acc_id",
                        "data_owner_name.$": "$.product_owner_name",
                        "pii_flag.$": "$.product_pii_flag"
                    }
                }
            },
            resultPath: JsonPath.DISCARD
        })

        tablesMapTask.iterator(createTable.next(grantTablePermissions))

        // State machine dependencies
        tablesMapTask.next(triggerProducer)

        createDatabase.addCatch(tablesMapTask, {
            errors: ["Glue.AlreadyExistsException"], resultPath: "$.Exception"
        }).next(updateDatabaseOwnerMetadata).next(tablesMapTask)

        grantProducerAccess.next(createDatabase)

        grantLfAdminAccess.next(grantProducerAccess);

        registerS3Location.addCatch(grantLfAdminAccess, {
            errors: [
                "LakeFormation.AlreadyExistsException"
            ],
            resultPath: "$.Exception"
        }).next(grantLfAdminAccess);

        // State machine to register data product from Data Domain
        new StateMachine(this, 'RegisterDataProduct', {
            definition: registerS3Location,
            role: props.lfAdminRole,
        });
    }
}
