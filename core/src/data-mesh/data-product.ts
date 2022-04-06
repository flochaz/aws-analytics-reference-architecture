// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct } from '@aws-cdk/core';


/**
 * Properties for the DataProductPros Construct
 */
export interface DataProductPros {

}

/**
 * DataProduct Construct to create a new data product in Data Domain account and register it in central
 */
export class DataProduct extends Construct {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        // TODOs:

        // 1. cross-account bucket policy to allow Central account access (existing ARA construct)

        // 2. create a Database (existing ARA construct) OR with a custom name

        // 3. send an event to EventBridge Bus in central account to trigger RegisterDataProduct workflow via CustomResource
        // --> send database name and a list of tables to be created

    }
}
