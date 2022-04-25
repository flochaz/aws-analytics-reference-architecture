// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct } from '@aws-cdk/core';
import { IRole } from '@aws-cdk/aws-iam';
import { DataLakeStorage } from '../data-lake-storage';
import { DataDomainWorkflow } from './data-domain-workflow';
import { DataDomainCrawler } from './data-domain-crawler';


/**
 * Properties for the DataDomain Construct
 */
export interface DataDomainPros {
    /**
    * Central data mesh account Id
    */
    readonly centralAccId: string;

    /**
    * Flag to create a Crawler workflow in data domain account
    */
    readonly crawlerWorkflow?: boolean,

    /**
    * Lake Formation admin role
    */
    lfAdminRole: IRole;
}

/**
 * DataDomain Construct to create all the resource in Data Domain account
 */
export class DataDomain extends Construct {

    readonly dataLake: DataLakeStorage;
    readonly dataDomainWorkflow: DataDomainWorkflow;

    constructor(scope: Construct, id: string, props: DataDomainPros) {
        super(scope, id);

        // Create a data lake with (ARA constructs)
        this.dataLake = new DataLakeStorage(this, "dataLakeStorage");

        // Create Lake Formation Admin role
        // TODO: use existing ARA constructs when ready (lf-admin) OR get LF Admin role as parameter

        this.dataDomainWorkflow = new DataDomainWorkflow(this, "DataDomainWorkflow", {
            lfAdminRole: props.lfAdminRole,
            centralAccId: props.centralAccId,
        });

        if (props.crawlerWorkflow) {
            const dataDomainWorkflowArn = this.dataDomainWorkflow.stateMachine.stateMachineArn;
            new DataDomainCrawler(this, "DataDomainCrawler", { lfAdminRole: props.lfAdminRole, dataDomainWorkflowArn });
        }
    }
}
