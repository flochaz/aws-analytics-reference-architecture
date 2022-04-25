// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { ManagedPolicy, PolicyStatement } from '@aws-cdk/aws-iam';
import { CompositePrincipal, Effect, ManagedPolicy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { CfnDataLakeSettings } from '@aws-cdk/aws-lakeformation';
import { App, Stack } from '@aws-cdk/core';

import { CentralGovernance } from '.';


const mockApp = new App();
const stack = new Stack(mockApp, 'centralGovernance');

const lfAdminRole = new Role(stack, "LakeFormationLocationRole", {
    assumedBy: new CompositePrincipal(
        new ServicePrincipal("glue.amazonaws.com"),
        new ServicePrincipal("lakeformation.amazonaws.com")
    ),
    managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole")],
    inlinePolicies: {
        CentralGovernancePolicy: new PolicyDocument({
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: [
                        "events:PutEvents"
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

new CfnDataLakeSettings(stack, "LFDataLakeSettings", {
    admins: [
        {
            dataLakePrincipalIdentifier: lfAdminRole.roleArn
        }
    ]
})

new CentralGovernance(stack, "CentralGovernance", {
    lfAdminRole,
});
