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
    * Central EventBus Name
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
 * DataDomainRegistration Construct to register a new Data Domain account in Central account
 */
export class DataDomainRegistration extends Construct {
    constructor(scope: Construct, id: string, props: DataDomainRegistrationProps) {
        super(scope, id);

        const eventBusName = props.eventBusName || `${Aws.ACCOUNT_ID}_centralEventBus`;
        const eventBus = EventBus.fromEventBusName(this, 'dataDomainEventBus', eventBusName);
        const dataDomainBusArn = `arn:aws:events:${props.dataDomainRegion}:${props.dataDomainAccId}`
            + `:event-bus/${props.dataDomainAccId}_dataDomainEventBus`

        // Cross-account policy to allow data domain account to send events to central account event bus
        new CfnEventBusPolicy(this, 'Policy', {
            eventBusName: eventBusName,
            statementId: 'AllowCentralAccountToPutEvents',
            action: 'events:PutEvents',
            principal: props.dataDomainAccId,
        });

        // Event Bridge Rule to trigger createResourceLinks workflow in target data domain account
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
                `putEventsTo_${props.dataDomainAccId}`,
                dataDomainBusArn
            )),
        );
        rule.applyRemovalPolicy(RemovalPolicy.DESTROY);

        // TODO Add Rule to catch event from DataProduct construct and trigger CentralGovernance's RegisterDataProduct workflow
    }
}
