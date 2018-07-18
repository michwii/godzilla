var request = require('request');
var async = require('async');


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


var sendDataToOMS = function(workspaceId, sharedKey, dataType, logs, callback){
    // required node.js libraries
    var crypto = require('crypto');

    var apiVersion = '2016-04-01';
    var processingDate = new Date().toUTCString();
    
    if(Array.isArray(logs)){
        for(var i = 0; i < logs.length; i++){
            logs[i] = flattenObject(logs[i]);
        }
    }
    
    var body = JSON.stringify(logs);
    var contentLength = Buffer.byteLength(body, 'utf8');

    var stringToSign = 'POST\n' + contentLength + '\napplication/json\nx-ms-date:' + processingDate + '\n/api/logs';
    var signature = crypto.createHmac('sha256', new Buffer(sharedKey, 'base64')).update(stringToSign, 'utf-8').digest('base64');
    var authorization = 'SharedKey ' + workspaceId + ':' + signature;

    var headers = {
        "content-type": "application/json", 
        "Authorization": authorization,
        "Log-Type": dataType,
        "x-ms-date": processingDate
    };

    var url = 'https://' + workspaceId + '.ods.opinsights.azure.com/api/logs?api-version=' + apiVersion;

    request.post({url: url, headers: headers, body: body}, function(err, httpRequest, responseBody){
        if(err){
            
            callback(httpRequest.statusCode);
        }else{
            callback(err, "Data sent to OMS. Return code : " + httpRequest.statusCode);
        }
    });

} ;

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

var flattenObject = function(ob) {
	var toReturn = {};
	
	for (var i in ob) {
		if (!ob.hasOwnProperty(i)) continue;
		
		if ((typeof ob[i]) == 'object') {
			var flatObject = flattenObject(ob[i]);
			for (var x in flatObject) {
				if (!flatObject.hasOwnProperty(x)) continue;
				
				toReturn[i + '.' + x] = flatObject[x];
			}
		} else {
			toReturn[i] = ob[i];
		}
	}
	return toReturn;
};

var shouldIStoreThisResourceInsideMyOMS = function(resourceName, env){
    if(env.toUpperCase() === "RE" || env.toUpperCase() === "REC"){
        //In rec environnement, always need to add your resource because we have one unique OMS in this subscription.
        return true;
    }else if (env.toUpperCase() === "PPR" || env.toUpperCase() === "PP"){
        if(resourceName.includes("pp") || resourceName.includes("PP"))
            return true ;
        else
            return false;
    }else if(env.toUpperCase() === "PRA" || env.toUpperCase() === "PR"){
        if(resourceName.includes("pr") || resourceName.includes("PR"))
            return true ;
        else
            return false;
    }
    return false;
}

module.exports.sendDataToOMS = sendDataToOMS;
module.exports.getAccessToken = getAccessToken;
module.exports.flattenObject = flattenObject;
module.exports.getDataFromMSAPI = getDataFromMSAPI;
module.exports.shouldIStoreThisResourceInsideMyOMS = shouldIStoreThisResourceInsideMyOMS;
