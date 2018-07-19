var request = require('request');
var console = {};

var subscriptionId = process.env.SUBSCRIPTION_ID ;
var tenant_id = process.env.TENANT_ID;
var client_id = process.env.CLIENT_ID;
var client_secret = process.env.CLIENT_SECRET;
var resource_group_exclusions = process.env.RESOURCE_GROUP_EXCLUSIONS.split(',').map(function(x){ return x.toUpperCase();});
var delay_before_destruction = process.env.DELAY_BEFORE_DESTRUCTION;

module.exports = async function (context, myTimer) {
    var timeStamp = new Date().toISOString();
    console = context;

    var deadline = new Date();
    deadline.setTime(deadline.getTime() - (parseInt(delay_before_destruction)*1000));

    if(myTimer.isPastDue)
    {
        context.log('JavaScript is running late!');
    }

    if(allRequirementsArePresent()){
        console.log("Resource groups that are going to be ignored : ");
        console.log(resource_group_exclusions);   
        console.log("For the others, they will be deleted if they were created before : ");
        console.log(deadline);  
        console.log("Starting to analyse...");
        await deleteUnUsedResourceGroups();
        console.log("Work completed...");
        context.done();
    }else{
        console.log("Sorry but not all the required environment variables have been set...");
        console.log("To work properly, this application needs to be set in the application settings the following parameters : ");
        console.log("TENANT_ID");
        console.log("SUBSCRIPTION_ID");
        console.log("DELAY_BEFORE_DESTRUCTION");
        console.log("CLIENT_ID");
        console.log("CLIENT_SECRET");
        context.done();
    }

};

var allRequirementsArePresent = function(){
    return subscriptionId && tenant_id && client_id && client_secret && resource_group_exclusions && delay_before_destruction ;
}

var deleteUnUsedResourceGroups = async function (){
    var accessToken = await getAccessToken(tenant_id, client_id, client_secret);
    var resourceGroups = await getResourceGroupList(subscriptionId, accessToken);
    var resourceGroupNamesToDelete = new Array();
    for(var resourceGroup of resourceGroups){
        var deploymentsHistory = await getDeploymentsHistoryByResourceGroup(subscriptionId, accessToken, resourceGroup.name);
        var iCanDestroy = canIToDestroyThisResourceGroup(deploymentsHistory);
        var resourceGroupShouldBeExcluded = resource_group_exclusions.indexOf(resourceGroup.name.toUpperCase()) !== -1;
        if(iCanDestroy && !resourceGroupShouldBeExcluded){
            resourceGroupNamesToDelete.push(resourceGroup.name);
            console.log("Ressource group supprimé : " + resourceGroup.name);
        }
    }
    var resourceGroupsToDeletePromised = resourceGroupNamesToDelete.map(deleteResourceGroup.bind(null, subscriptionId, accessToken));
    Promise.all(resourceGroupsToDeletePromised);
}

var getResourceGroupList = async function(subscriptionId, accessToken){
    var url = "https://management.azure.com/subscriptions/"+ subscriptionId +"/resourcegroups?api-version=2017-05-10";
    return getDataFromMSAPI(accessToken, url) ;
}

var getDeploymentsHistoryByResourceGroup = async function(subscriptionId, accessToken, resourceGroupName) {
    var url = "https://management.azure.com/subscriptions/" + subscriptionId + "/resourcegroups/" + resourceGroupName + "/providers/Microsoft.Resources/deployments/?api-version=2018-02-01";
    return getDataFromMSAPI(accessToken, url) ;
}

var canIToDestroyThisResourceGroup = function(deploymentsHistory, exlusions, delayBeforeDestroying) {
    var latestDeployment = getLastDeployment(deploymentsHistory);
    var deadline = new Date();
    deadline.setTime(deadline.getTime() - (parseInt(delay_before_destruction)*1000));
    return deadline >= latestDeployment;
}

var getLastDeployment = function(deploymentsHistory){
    var lastDate = new Date();
    lastDate.setTime(0);
    for(var deployment of deploymentsHistory){
        var deploymentDate = new Date(deployment.properties.timestamp);
        if(deploymentDate > lastDate){
            lastDate = deploymentDate;
        }
    }
    return lastDate;
}

var deleteResourceGroup = async function(subscriptionId, accessToken, resourceGroupName){
    var url = "https://management.azure.com/subscriptions/"+subscriptionId+"/resourcegroups/" + resourceGroupName + "?api-version=2018-02-01";
    return getDataFromMSAPI(accessToken, url, "DELETE") ;
}

var getAccessToken = async function(tenant_id, client_id, client_secret){
    return new Promise((resolved, rejected) => {
        var url = "https://login.microsoftonline.com/" + tenant_id + "/OAuth2/Token";
        request.post({url:url, form: {
            grant_type : "client_credentials",
            client_id : client_id,
            client_secret : client_secret,
            resource : "https://management.core.windows.net/"
        }}, function(err, httpResponse, body){
            if(err){
                rejected(err);
            }else{
                var accessToken = JSON.parse(body).access_token;
                resolved(accessToken);
            }
        });
    });
};

var getDataFromMSAPI = async function(accessToken, url, method){
    return new Promise((resolved, rejected) => {
        method = (method) ? method : 'GET';
        request({
            url : url,
            method : method,
            'auth': {
                'bearer': accessToken
            }
        }, function(err, httpResponse, body){
            if(err){
                rejected(err);
            }else{
                var dataToReturn = JSON.parse(body).value;
                resolved(dataToReturn);
            }
        });
    });
}
