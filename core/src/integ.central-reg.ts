// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { ManagedPolicy, PolicyStatement } from '@aws-cdk/aws-iam';
import { App, Stack } from '@aws-cdk/core';
import { DataDomainRegistration } from './data-mesh';


const mockApp = new App();
const stack = new Stack(mockApp, 'DataDomainRegistration');

new DataDomainRegistration(stack, "DataDomainRegistration", {
    dataDomainRegion: 'xxx-region', dataDomainAccId: 'xxx'
});
