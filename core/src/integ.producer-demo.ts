// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { ManagedPolicy, PolicyStatement } from '@aws-cdk/aws-iam';
import { Role } from '@aws-cdk/aws-iam';
import { App, Stack } from '@aws-cdk/core';

import { DataDomainWorkflow } from './data-mesh';


const mockApp = new App();
const stack = new Stack(mockApp, 'DataDomainWorkflow');

new DataDomainWorkflow(stack, "DataDomainWorkflow", {
    centralAccId: "xxx",
    lfAdminRole: Role.fromRoleArn(stack, "dataDomainRole", "arn-role"),
});
