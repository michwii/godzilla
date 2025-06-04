'use strict';
const axios = require('axios');
let logger = console;

/**
    Retrieving all the application settings that are mandatory. 
    You should create a client principal in your azure subscription that have the right to READ / UPDATE and DELETE resources in Azure.
    list of resource groups to exclude separated by a comma. Not case sensitive. You should put at least the resource group where your Godzilla stands.
    Value of the parameter delay_before_destruction should be set in seconds.
*/
const subscriptionId = process.env.SUBSCRIPTION_ID;
const tenantId = process.env.TENANT_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const resource_group_exclusions = (process.env.RESOURCE_GROUP_EXCLUSIONS || '').split(',').map(x => x.toUpperCase());
const delay_before_destruction = process.env.DELAY_BEFORE_DESTRUCTION;

module.exports = async (context, myTimer) => {
    logger = context;

    const deadline = new Date();
    deadline.setTime(deadline.getTime() - (parseInt(delay_before_destruction)*1000));

    if(myTimer.isPastDue)
    {
        context.log('JavaScript is running late!');
    }

    if(allRequirementsArePresent()){
        logger.log('Resource groups that are going to be ignored : ');
        logger.log(resource_group_exclusions);
        logger.log('For the others, they will be deleted if they were created before : ');
        logger.log(deadline);
        logger.log('Starting to analyse...');
        await deleteUnUsedResourceGroups();
        logger.log('Work completed...');
        context.done();
    }else{
        logger.log('Sorry but not all the required environment variables have been set...');
        logger.log('To work properly, this application needs to set the following parameters :');
        logger.log('TENANT_ID');
        logger.log('SUBSCRIPTION_ID');
        logger.log('DELAY_BEFORE_DESTRUCTION');
        logger.log('CLIENT_ID');
        logger.log('CLIENT_SECRET');
        context.done();
    }

};

/**
   Making sure all the Application Settings are set and not empty 
   @return a boolean wheter or not the application can start.
*/
const allRequirementsArePresent = () => {
    return subscriptionId && tenantId && clientId && clientSecret && resource_group_exclusions && delay_before_destruction;
};

const deleteUnUsedResourceGroups = async () => {
    const accessToken = await getAccessToken(tenantId, clientId, clientSecret);
    const resourceGroups = await getResourceGroupList(subscriptionId, accessToken);
    const resourceGroupNamesToDelete = [];
    for (const resourceGroup of resourceGroups) {
        const deploymentsHistory = await getDeploymentsHistoryByResourceGroup(subscriptionId, accessToken, resourceGroup.name);
        const iCanDestroy = canIToDestroyThisResourceGroup(deploymentsHistory);
        const resourceGroupShouldBeExcluded = resource_group_exclusions.indexOf(resourceGroup.name.toUpperCase()) !== -1;
        if (iCanDestroy && !resourceGroupShouldBeExcluded) {
            resourceGroupNamesToDelete.push(resourceGroup.name);
            logger.log('Resource group deleted: ' + resourceGroup.name);
        }
    }
    const resourceGroupsToDeletePromised = resourceGroupNamesToDelete.map(deleteResourceGroup.bind(null, subscriptionId, accessToken));
    await Promise.all(resourceGroupsToDeletePromised);
};

/**
    @return Array of Resource groups
*/
const getResourceGroupList = async (subscriptionId, accessToken) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourcegroups?api-version=2017-05-10`;
    return getDataFromMSAPI(accessToken, url);
};

/**
    @return Array of Deployment History for a specific resource group
*/
const getDeploymentsHistoryByResourceGroup = async (subscriptionId, accessToken, resourceGroupName) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourcegroups/${resourceGroupName}/providers/Microsoft.Resources/deployments/?api-version=2018-02-01`;
    return getDataFromMSAPI(accessToken, url);
};

/**
    @return a boolean Wheter or not we can delete the resource group.
*/
const canIToDestroyThisResourceGroup = (deploymentsHistory) => {
    const latestDeployment = getLastDeployment(deploymentsHistory);
    const deadline = new Date();
    deadline.setTime(deadline.getTime() - (parseInt(delay_before_destruction) * 1000));
    return deadline >= latestDeployment;
};

/**
    @return the latest deployement date of a resource group.
    For empty resource groups or resource group without deployment (deploying a storage account is not considered as a deployment),
    current timestamp in date format is returned.
*/
const getLastDeployment = (deploymentsHistory) => {
    let lastDate = new Date(0);
    for (const deployment of deploymentsHistory) {
        const deploymentDate = new Date(deployment.properties.timestamp);
        if (deploymentDate > lastDate) {
            lastDate = deploymentDate;
        }
    }
    return lastDate;
};

const deleteResourceGroup = async (subscriptionId, accessToken, resourceGroupName) => {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourcegroups/${resourceGroupName}?api-version=2018-02-01`;
    return getDataFromMSAPI(accessToken, url, 'DELETE');
};

/**
    return accessToken that can be used to perform action on Azure REST API.
*/
const getAccessToken = async (tenantId, clientId, clientSecret) => {
    const url = `https://login.microsoftonline.com/${tenantId}/OAuth2/Token`;
    try {
        const response = await axios.post(url, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            resource: 'https://management.core.windows.net/'
        });
        return response.data.access_token;
    } catch (err) {
        throw err;
    }
};

/**
    Helper that getting result from MS API. It abstract the use of Request librairy.
    @return MS API request result.
*/
const getDataFromMSAPI = async (accessToken, url, method = 'GET') => {
    try {
        const response = await axios({
            url,
            method,
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data.value;
    } catch (err) {
        throw err;
    }
};
