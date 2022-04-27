// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// import { Bucket } from '@aws-cdk/aws-s3';
import { Construct } from '@aws-cdk/core';
import { S3CrossAccount, S3CrossAccountProps } from '../s3-cross-account';


/**
 * Properties for the DataProductPros Construct
 */
export interface DataProductProps {
    /**
    * S3CrossAccountProps for S3CrossAccount construct
    */
    readonly crossAccountAccessProps: S3CrossAccountProps,

    /**
    * Database name for data product
    */
    readonly databaseName?: string,
}

/**
 * DataProduct Construct to create a new data product in Data Domain account and register it in central account
 */
export class DataProduct extends Construct {
    constructor(scope: Construct, id: string, props: DataProductProps) {
        super(scope, id);

        // cross-account bucket policy to allow Central account access (existing ARA construct)
        new S3CrossAccount(this, "CentralCrossAccountAccess", props.crossAccountAccessProps)

        // TODO: Optional to trigger an EventBridge event via CustomResource in central account if used without the UI
        // --> This is to create a new data product by passing database name and table names to central account

    }
}
