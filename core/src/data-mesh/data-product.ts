// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Rule } from '@aws-cdk/aws-events';
import { SfnStateMachine } from '@aws-cdk/aws-events-targets';
import { Role } from '@aws-cdk/aws-iam';
// import { Bucket } from '@aws-cdk/aws-s3';
import { Choice, Condition, JsonPath, Map, Pass, StateMachine, Wait, WaitTime } from '@aws-cdk/aws-stepfunctions';
import { CallAwsService } from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';
// import { S3CrossAccount } from '../s3-cross-account';


/**
 * Properties for the DataProductPros Construct
 */
export interface DataProductProps {
    productBucketName: string,
    centralAccountId: string,
    crawlerWorkflow?:boolean,
    dataDomainWorkflowArn?:string,
    lfAdminRole?:Role
}

/**
 * DataProduct Construct to create a new data product in Data Domain account and register it in central
 */
export class DataProduct extends Construct {
    constructor(scope: Construct, id: string, props: DataProductProps) {
        super(scope, id);

        // 1. cross-account bucket policy to allow Central account access (existing ARA construct)
        // new S3CrossAccount(this, "CentralCrossAccountAccess", {
        //     bucket: Bucket.fromBucketName(this, "productBucket", props.productBucketName),
        //     accountID: props.centralAccountId
        // })

        // 2. Crawler
        if (props && props.crawlerWorkflow && props.dataDomainWorkflowArn && props.lfAdminRole) {
            //crawler state machine
            const parseEventPayload = new Pass(this, "ParseEventPayload", {
                inputPath: "$.detail.input",
                parameters: {
                    "payload.$": "States.StringToJson($)"
                }
            });

            const traverseTableArray = new Map(this, "TraverseTableArray", {
                itemsPath: "$.payload.detail.table_names",
                maxConcurrency: 2,
                parameters: {
                    "tableName.$": "States.Format('rl-{}', $$.Map.Item.Value)",
                    "databaseName.$": "$.payload.detail.database_name"
                },
                resultPath: JsonPath.DISCARD
            })

            const grantPermissions = new CallAwsService(this, "GrantPermissions", {
                service: "lakeformation",
                action: "grantPermissions",
                iamResources: ["*"],
                parameters: {
                    "Permissions": [
                        "ALL"
                    ],
                    "Principal": {
                        "DataLakePrincipalIdentifier": props.lfAdminRole.roleArn
                    },
                    "Resource": {
                        "Table": {
                            "DatabaseName.$": "$.databaseName",
                            "Name.$": "$.tableName"
                        }
                    }
                },
                resultPath: JsonPath.DISCARD
            })

            const createCrawlerForTable = new CallAwsService(this, "CreateCrawlerForTable", {
                service: "glue",
                action: "createCrawler",
                iamResources: ["*"],
                parameters: {
                    "Name.$": "States.Format('{}_{}_{}', $$.Execution.Id, $.databaseName, $.tableName)",
                    "Role": props.lfAdminRole.roleArn,
                    "Targets": {
                    "CatalogTargets": [
                            {
                                "DatabaseName.$": "$.databaseName",
                                "Tables.$": "States.Array($.tableName)"
                            }
                        ]
                    },
                    "SchemaChangePolicy": {
                        "DeleteBehavior": "LOG",
                        "UpdateBehavior": "UPDATE_IN_DATABASE"
                    }
                },
                resultPath: JsonPath.DISCARD
            })

            const startCrawler = new CallAwsService(this, "StartCrawler", {
                service: "glue",
                action: "startCrawler",
                iamResources: ["*"],
                parameters: {
                    "Name.$": "States.Format('{}_{}_{}', $$.Execution.Id, $.databaseName, $.tableName)"
                },
                resultPath: JsonPath.DISCARD
            })

            const waitForCrawler = new Wait(this, "WaitForCrawler", {
                time: WaitTime.duration(Duration.seconds(15))
            });

            const getCrawler = new CallAwsService(this, "GetCrawler", {
                service: "glue",
                action: "getCrawler",
                iamResources: ["*"],
                parameters: {
                    "Name.$": "States.Format('{}_{}_{}', $$.Execution.Id, $.databaseName, $.tableName)"
                },
                resultPath: "$.crawlerInfo"
            })

            const checkCrawlerStatusChoice = new Choice(this, "CheckCrawlerStatusChoice")
            const deleteCrawler = new CallAwsService(this, "DeleteCrawler", {
                service: "glue",
                action: "deleteCrawler",
                iamResources: ["*"],
                parameters: {
                    "Name.$": "States.Format('{}_{}_{}', $$.Execution.Id, $.databaseName, $.tableName)"
                },
                resultPath: JsonPath.DISCARD
            })

            deleteCrawler.endStates
            checkCrawlerStatusChoice.when(Condition.not(Condition.stringEquals("$.crawlerInfo.Crawler.State", "RUNNING")), deleteCrawler).otherwise(waitForCrawler)


            getCrawler.next(checkCrawlerStatusChoice);
            waitForCrawler.next(getCrawler);
            startCrawler.next(waitForCrawler);
            createCrawlerForTable.next(startCrawler)
            grantPermissions.next(createCrawlerForTable);

            traverseTableArray.iterator(grantPermissions).endStates;
            parseEventPayload.next(traverseTableArray)

            const updateTableSchemasStateMachine = new StateMachine(this, "UpdateTableSchemas", {
                definition: parseEventPayload,
                role: props.lfAdminRole
            });

            new Rule(this, "TriggerUpdateTableSchemasRule", {
                targets: [
                    new SfnStateMachine(updateTableSchemasStateMachine)
                ],
                eventPattern: {
                    source: ["aws.states"],
                    detailType: ["Step Functions Execution Status Change"],
                    detail: {
                        "status": ["SUCCEEDED"],
                        "stateMachineArn": [props.dataDomainWorkflowArn]
                    }
                }
            })
        }
    }
}
