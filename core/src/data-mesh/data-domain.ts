// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct } from '@aws-cdk/core';


/**
 * Properties for the DataDomain Construct
 */
export interface DataDomainPros {

}

/**
 * DataDomain Construct to create all the resource in Data Domain account
 */
export class DataDomain extends Construct {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        // TODOs:

        // 1. create a data lake with (ARA constructs)

        // 2. create Lake Formation Admin role (existing ARA constructs) OR get LF Admin role as parameter

        // 3. Initiatie here DataDomainWorkflow from 'data-domain-workflow.ts' and pass LF Admin and centralAccId to it.
    }
}
