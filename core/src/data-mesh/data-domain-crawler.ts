// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Rule } from '@aws-cdk/aws-events';
import { SfnStateMachine } from '@aws-cdk/aws-events-targets';
import { IRole } from '@aws-cdk/aws-iam';
import { Choice, Condition, JsonPath, Map, Pass, StateMachine, Wait, WaitTime } from '@aws-cdk/aws-stepfunctions';
import { CallAwsService } from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';


/**
 * Properties for the DataDomainCrawlerProps Construct
 */
export interface DataDomainCrawlerProps {
    /**
    * ARN of DataDomainWorkflow State Machine
    */
    dataDomainWorkflowArn: string,

    /**
    * LF Admin Role
    */
    lfAdminRole: IRole
}

/**
 * DataDomainCrawler Construct to create a Crawler workflow in data domain account
 */
export class DataDomainCrawler extends Construct {
    constructor(scope: Construct, id: string, props: DataDomainCrawlerProps) {
        super(scope, id);

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
        });

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
        });

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
        });

        const startCrawler = new CallAwsService(this, "StartCrawler", {
            service: "glue",
            action: "startCrawler",
            iamResources: ["*"],
            parameters: {
                "Name.$": "States.Format('{}_{}_{}', $$.Execution.Id, $.databaseName, $.tableName)"
            },
            resultPath: JsonPath.DISCARD
        });

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
        });

        const checkCrawlerStatusChoice = new Choice(this, "CheckCrawlerStatusChoice");

        const deleteCrawler = new CallAwsService(this, "DeleteCrawler", {
            service: "glue",
            action: "deleteCrawler",
            iamResources: ["*"],
            parameters: {
                "Name.$": "States.Format('{}_{}_{}', $$.Execution.Id, $.databaseName, $.tableName)"
            },
            resultPath: JsonPath.DISCARD
        });

        deleteCrawler.endStates;
        checkCrawlerStatusChoice
            .when(Condition.stringEquals("$.crawlerInfo.Crawler.State", "READY"), deleteCrawler)
            .otherwise(waitForCrawler);


        getCrawler.next(checkCrawlerStatusChoice);
        waitForCrawler.next(getCrawler);
        startCrawler.next(waitForCrawler);
        createCrawlerForTable.next(startCrawler);
        grantPermissions.next(createCrawlerForTable);

        traverseTableArray.iterator(grantPermissions).endStates;
        parseEventPayload.next(traverseTableArray);

        const initState = new Wait(this, "WaitForMetadata", {
            time: WaitTime.duration(Duration.seconds(15))
        })

        initState.next(parseEventPayload);

        const updateTableSchemasStateMachine = new StateMachine(this, "UpdateTableSchemas", {
            definition: initState,
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
        });
    }
}
