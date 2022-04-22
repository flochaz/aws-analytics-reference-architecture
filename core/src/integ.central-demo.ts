// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { ManagedPolicy, PolicyStatement } from '@aws-cdk/aws-iam';
import { Role } from '@aws-cdk/aws-iam';
import { App, Stack } from '@aws-cdk/core';

import { CentralGovernance } from './data-mesh';


const mockApp = new App();
const stack = new Stack(mockApp, 'centralGovernance');

new CentralGovernance(stack, "CentralGovernance", {
    lfAdminRole: Role.fromRoleArn(stack, "CentralRole", "arn-role"),
});
