// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct, Aws, RemovalPolicy } from '@aws-cdk/core';
import { CfnEventBusPolicy, Rule, EventBus } from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';


/**
 * Properties for the DataDomainRegistration Construct
 */
export interface DataDomainRegistrationProps {
    /**
    * EventBus Name in Central Governance account
    */
    readonly eventBusName?: string;

    /**
    * Data Domain Account region
    */
    readonly dataDomainRegion: string;

    /**
    * Data Domain Account Id
    */
    readonly dataDomainAccId: string;
}

/**
 * This CDK Construct registers a new Data Domain account in Central Governance account.
 * It does that by creating a cross-account policy for Amazon EventBridge Event Bus to 
 * enable Data Domain to send events to Central Gov. account. It also creates a Rule to forward events to target Data Domain account.
 * Each Data Domain account {@link DataDomain} has to be registered in Central Gov. account before it can participate in a mesh.
 * 
 * Usage example:
 * ```typescript
 * import * as cdk from '@aws-cdk/core';
 * import { Role } from '@aws-cdk/aws-iam';
 * import { DataDomainRegistration } from 'aws-analytics-reference-architecture';
 * 
 * const exampleApp = new cdk.App();
 * const stack = new cdk.Stack(exampleApp, 'DataProductStack');
 * 
 * new DataDomainRegistration(stack, 'registerDataDomain', {
 *  dataDomainAccId: "1234567891011",
 *  dataDomainRegion: "us-east-1"
 * });
 * ```
 * 
 */
export class DataDomainRegistration extends Construct {
    /**
     * Construct a new instance of DataDomainRegistration.
     * @param {Construct} scope the Scope of the CDK Construct
     * @param {string} id the ID of the CDK Construct
     * @param {DataDomainRegistrationProps} props the DataDomainRegistrationProps properties
     * @access public
     */

    constructor(scope: Construct, id: string, props: DataDomainRegistrationProps) {
        super(scope, id);

        const eventBusName = props.eventBusName || `${Aws.ACCOUNT_ID}_centralEventBus`;
        const eventBus = EventBus.fromEventBusName(this, 'dataDomainEventBus', eventBusName);
        const dataDomainBusArn = `arn:aws:events:${props.dataDomainRegion}:${props.dataDomainAccId}`
            + `:event-bus/${props.dataDomainAccId}_dataDomainEventBus`;

        // Cross-account policy to allow Data Domain account to send events to Central Gov. account event bus
        new CfnEventBusPolicy(this, 'Policy', {
            eventBusName: eventBusName,
            statementId: `AllowDataDomainAccToPutEvents_${props.dataDomainAccId}`,
            action: 'events:PutEvents',
            principal: props.dataDomainAccId,
        });

        // Event Bridge Rule to trigger createResourceLinks workflow in target Data Domain account
        const rule = new Rule(this, 'Rule', {
            eventPattern: {
                source: ['com.central.stepfunction'],
                detailType: [`${props.dataDomainAccId}_createResourceLinks`],
            },
            eventBus,
        });

        rule.addTarget(new targets.EventBus(
            EventBus.fromEventBusArn(
                this,
                'DomainEventBus',
                dataDomainBusArn
            )),
        );
        rule.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }
}
