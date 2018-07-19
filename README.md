# Godzilla
Godzilla is a simple Azure Function that you should schedule every day. This function will destroy every resource group that is not use inside your suscription.

### How Does it work
Godzilla scans your subscription and extract a list of resource groups to delete according to 2 criterias :
1. Whether or not the resource group is inside an exlusion list (application setting parameter = RESOURCE_GROUP_EXCLUSIONS)
2. The delay to wait before destroying a resource group (application setting parameter = DELAY_BEFORE_DESTRUCTION)
If you have multiple subscriptions, you will have to have several instances of Godzilla, one in each subscription.
For the DELAY_BEFORE_DESTRUCTION parameter, the application will extract the **deployment history** of the resource group. 
The timer start after le last deployment.

List of examples :

Delay before destruction (value should be written in seconds) | Last deployment | Result
------------------------------------------------------------- | --------------- | ------
30 days | 28 days ago | No destruction
30 days | 35 days ago | Destruction
30 days | No deployment history (happen if the resource group is empty or no computing resource has been deployed) | Destruction


#### When to use it
Perfect for **non production** resources. Allows you to clean your subscription of non utilized resources and reduce your bill.

#### When to avoid it
Avoid to deploy this Function in a Production environment. If you are mixing production and non production resources in the same souscription, you will have to add in the resource groups to exlude all the production resource group. The best practice would have been to segregate production resources and non production resources in different subscriptions.

### Requirement pamareters
You have 6 parameters that are required : 
- TENANT_ID
- SUBSCRIPTION_ID
- DELAY_BEFORE_DESTRUCTION
- CLIENT_ID
- CLIENT_SECRET
- RESOURCE_GROUP_EXCLUSIONS

You should create a client principal in your azure subscription that have the right to READ / UPDATE and DELETE resources in Azure.
After creation, you should have a CLIENT_ID and a CLIENT_SECRET at your disposal. Put them in the application settings.
RESOURCE_GROUP_EXCLUSIONS contains resource group to exclude separated by a comma. Not case sensitive. You should put at least the resource group where your Godzilla stands.
Value of the parameter DELAY_BEFORE_DESTRUCTION should be set in seconds.

### Installation

1. Create a client principal and retrieve your CLIENT_ID and CLIENT_SECRET.
2. Create an Azure Function called Godzilla-YOUR_COMPANY in NODE JS that is scheduled and not triggered by an HTTP request.
Copy / Paste the source code present in the index.js in your Azure Function.
3. Add the **6** mandatory application settings in your Azure Function.
4. Communicate about your Godzilla within your company or otherwise you will create surprises.

### Contribution
Look for a project's contribution instructions. If there are any, follow them.

- Create a personal fork of the project on Github.
- Clone the fork on your local machine. Your remote repo on Github is called origin.
- Add the original repository as a remote called upstream.
- If you created your fork a while ago be sure to pull upstream changes into your local repository.
- Create a new branch to work on! Branch from develop if it exists, else from master.
- Implement/fix your feature, comment your code.
- Follow the code style of the project, including indentation.
- If the project has tests run them!
- Write or adapt tests as needed.
- Add or change the documentation as needed.
- Squash your commits into a single commit with git's interactive rebase. Create a new branch if necessary.
- Push your branch to your fork on Github, the remote origin.
- From your fork open a pull request in the correct branch. Target the project's develop branch if there is one, else go for master!

Once the pull request is approved and merged you can pull the changes from upstream to your local repo and delete your extra branch(es).
And last but not least: Always write your commit messages in the present tense. Your commit message should describe what the commit, when applied, does to the code – not what you did to the code.
