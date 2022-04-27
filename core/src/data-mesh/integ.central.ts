// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { ManagedPolicy, PolicyStatement } from '@aws-cdk/aws-iam';
import { CompositePrincipal, Effect, ManagedPolicy, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { CfnDataLakeSettings } from '@aws-cdk/aws-lakeformation';
import { App, CfnParameter, Stack } from '@aws-cdk/core';

import { CentralGovernance } from '.';
import { DataDomainRegistration } from '.';


const mockApp = new App();
const stack = new Stack(mockApp, 'centralGovernance');

const lfAdminRole = new Role(stack, "LakeFormationLocationRole", {
    assumedBy: new CompositePrincipal(
        new ServicePrincipal("glue.amazonaws.com"),
        new ServicePrincipal("lakeformation.amazonaws.com"),
        new ServicePrincipal("states.amazonaws.com")
    ),
    managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole"),
        ManagedPolicy.fromAwsManagedPolicyName("AWSLakeFormationCrossAccountManager")
    ],
    inlinePolicies: {
        CentralGovernancePolicy: new PolicyDocument({
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "events:Put*"
                    ],
                    resources: [
                        "*"
                    ]
                }),
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "s3:GetObject",
                        "s3:PutObject",
                        "s3:ListBucket"
                    ],
                    resources: ["*"]
                })
            ]
        })
    }
});

const producerAccountId = new CfnParameter(stack, "producerAccountId", {
    type: "String"
})

const producerAccountRegion = new CfnParameter(stack, "producerRegion", {
    type: "String"
})

// const consumerAccountId = new CfnParameter(stack, "consumerAccountId", {
//     type: "String"
// })

// const consumerRegion = new CfnParameter(stack, "consumerRegion", {
//     type: "String"
// })

lfAdminRole.attachInlinePolicy(new Policy(stack, "IAMRelatedPolicies", {
    document: new PolicyDocument({
        statements: [
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["iam:PassRole"],
                resources: [lfAdminRole.roleArn]
            })
        ]
    })
}))

new CfnDataLakeSettings(stack, "LFDataLakeSettings", {
    admins: [
        {
            dataLakePrincipalIdentifier: lfAdminRole.roleArn
        }
    ]
})

const central = new CentralGovernance(stack, "CentralGovernance", {
    lfAdminRole,
});

const registerProducer = new DataDomainRegistration(stack, "RegisterProducer", {
    dataDomainAccId: producerAccountId.valueAsString,
    dataDomainRegion: producerAccountRegion.valueAsString
})

registerProducer.node.addDependency(central)

// new DataDomainRegistration(stack, "RegisterConsumer", {
//     dataDomainAccId: consumerAccountId.valueAsString,
//     dataDomainRegion: consumerRegion.valueAsString
// })