# godzilla
Godzilla is a simple Azure Function that you should schedule every day. This function will destroy every resource group that is not use inside your suscription.

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
