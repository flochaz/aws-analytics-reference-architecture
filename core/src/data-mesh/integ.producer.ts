// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { ManagedPolicy, PolicyStatement } from '@aws-cdk/aws-iam';
import { CompositePrincipal, Effect, ManagedPolicy, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { CfnDataLakeSettings } from '@aws-cdk/aws-lakeformation';
import { App, CfnParameter, Stack } from '@aws-cdk/core';
import { Key } from '@aws-cdk/aws-kms';
import { DataDomain } from './data-domain';
import { DataProduct } from './data-product';

const env = { account: 'xxx', region: 'xxx' };
const mockApp = new App();
const stack = new Stack(mockApp, 'producer', { env });

const lfAdminRole = new Role(stack, "LakeFormationLocationRole", {
    assumedBy: new CompositePrincipal(
        new ServicePrincipal("glue.amazonaws.com"),
        new ServicePrincipal("lakeformation.amazonaws.com"),
        new ServicePrincipal("states.amazonaws.com"),
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

const centralAccountId = new CfnParameter(stack, "centralAccountId", {
    type: "String"
});

new CfnDataLakeSettings(stack, "LFDataLakeSettings", {
    admins: [
        {
            dataLakePrincipalIdentifier: lfAdminRole.roleArn
        }
    ]
})

const producerDataDomain = new DataDomain(stack, "DataDomainProducer", {
    centralAccId: centralAccountId.valueAsString,
    lfAdminRole,
    crawlerWorkflow: true
})

const myKeyLookup = Key.fromLookup(stack, 'CleanBucketKmsKey', {
    aliasName: 'alias/aws/s3',
});

const dataProduct = new DataProduct(stack, "DPtpcdsCallCenter", {
    crossAccountAccessProps: {
        bucket: producerDataDomain.dataLake.cleanBucket,
        accountID: centralAccountId.valueAsString,
        objectKey: "tpcds/call_center",
        keyArn: myKeyLookup.keyArn,
    }
});

dataProduct.node.addDependency(producerDataDomain);
