// Contains the main LLM researcher logic
import { LLMCommunication, LLMConfig, LLMProviderType } from './llm_communication.js';
import { PersistentStorage } from './persistent_storage.js';
import {
  SpecializedAgent,
  ProactiveBugFinder,
  BugPatternAnalysisAgent,
  CodebaseUnderstandingAgent,
  GenericTaskAgent,
  GenericTaskAgentConfig,
  SpecializedAgentType
} from './specialized_agents.js';
import { ChromiumAPI } from '../api.js';
import { loadConfig as loadChromiumHelperConfig } from '../config.js';


export class LLMResearcher {
  private llmComms: LLMCommunication;
  private storage: PersistentStorage;
  private specializedAgents: Map<SpecializedAgentType, SpecializedAgent>;
  private chromiumApi!: ChromiumAPI; // Definite assignment assertion, will be set in async constructor/init

  // Private constructor to force initialization via static async method
  private constructor() {
    // Initialize LLM communication and storage synchronously
    const llmConfig: LLMConfig = {
      provider: LLMProviderType.Ollama,
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: process.env.OLLAMA_MODEL || "llama3", // Environment variable or default
      // apiKey: process.env.OPENAI_API_KEY, // Only if using OpenAI
    };
    this.llmComms = new LLMCommunication(llmConfig);
    this.storage = new PersistentStorage('LLMResearcher_main');
    this.specializedAgents = new Map();
    // Note: chromiumApi is not initialized here yet.
  }

  public static async create(): Promise<LLMResearcher> {
    const researcher = new LLMResearcher();
    await researcher.initializeAsyncComponents();
    return researcher;
  }

  private async initializeAsyncComponents(): Promise<void> {
    try {
      const chHelperConfig = await loadChromiumHelperConfig();
      this.chromiumApi = new ChromiumAPI(chHelperConfig.apiKey);
      this.chromiumApi.setDebugMode(process.env.CH_AGENT_DEBUG === 'true'); // Allow debug for underlying API
      console.log("ChromiumAPI initialized for LLMResearcher.");

      // Now that chromiumApi is initialized, we can create specialized agents that depend on it.
      this.initializeSpecializedAgents();
      await this.loadResearcherData(); // Load persistent data
      console.log("LLM Researcher fully initialized.");

    } catch (error) {
      console.error("Failed to initialize LLMResearcher's async components:", error);
      // Decide how to handle this - throw, or operate in a degraded mode?
      // For now, if ChromiumAPI fails, many features will be broken.
      throw new Error("LLMResearcher async initialization failed.");
    }
  }

  private initializeSpecializedAgents(): void {
    if (!this.chromiumApi) {
      console.warn("ChromiumAPI not initialized. Skipping specialized agent creation that depend on it.");
      return;
    }
    // Pass necessary dependencies to agents
    const bugFinder = new ProactiveBugFinder(this.llmComms, this.chromiumApi);
    this.specializedAgents.set(SpecializedAgentType.ProactiveBugFinding, bugFinder);

    const patternAnalyzer = new BugPatternAnalysisAgent(this.llmComms, this.chromiumApi);
    this.specializedAgents.set(SpecializedAgentType.BugPatternAnalysis, patternAnalyzer);

    const codebaseUnderstander = new CodebaseUnderstandingAgent(this.llmComms, this.chromiumApi);
    this.specializedAgents.set(SpecializedAgentType.CodebaseUnderstanding, codebaseUnderstander);

    console.log("Specialized agents (ProactiveBugFinder, BugPatternAnalysisAgent, CodebaseUnderstandingAgent) initialized.");

    // Optionally, auto-start some agents
    // bugFinder.start();
  }

  private async loadResearcherData(): Promise<void> {
    const data = await this.storage.loadData<{ lastQuery?: string }>();
    if (data) {
      console.log("LLMResearcher: Loaded data - ", data);
      // Example: Restore some state from 'data'
      if (data.lastQuery) {
        // console.log("Last query was:", data.lastQuery);
      }
    }
  }

  private async saveResearcherData(dataToSave: object): Promise<void> {
    await this.storage.saveData(dataToSave);
    console.log("LLMResearcher: Data saved.");
  }

  // private initializeSpecializedAgents(): void {
  //   const bugFinder = new ProactiveBugFinder(/* pass chromiumApi, llmComms */);
  //   this.specializedAgents.set(SpecializedAgentType.ProactiveBugFinding, bugFinder);
  //   // TODO: Initialize other agents (BugPatternAnalysis, CodebaseUnderstanding)
  //   // TODO: Start agents (e.g., bugFinder.start())
  //   console.log("Specialized agents initialized (placeholder).");
  // }

  public async processQuery(query: string, conversationHistory: string[] = []): Promise<string> {
    console.log(`Researcher processing query: ${query}`);

    // Basic conversation history (can be improved)
    // const historyContext = conversationHistory.join("\n");
    const systemPrompt = `You are a lead AI security researcher for Chromium. Your goal is to assist the user in finding vulnerabilities and understanding the codebase.
You have access to specialized AI agents:
- ProactiveBugFinder: Actively searches for bugs.
- BugPatternAnalysis: Learns from past bugs to identify risky patterns.
- CodebaseUnderstanding: Builds knowledge about how Chromium code works.
Be concise and helpful. You can use tools by prefixing commands with '!' (e.g., !search query, !start-agent ProactiveBugFinding).
The user is interacting with you via a CLI chatbot.`;

    let enrichedQuery = query;
    let agentContributions = "";

    // --- Attempt to leverage specialized agents ---

    // 1. Check if query relates to bug patterns or asks for advice on a snippet
    if (query.toLowerCase().includes("pattern") || query.toLowerCase().includes("advice for code")) {
      const bpaAgent = this.specializedAgents.get(SpecializedAgentType.BugPatternAnalysis) as BugPatternAnalysisAgent | undefined;
      if (bpaAgent && (await bpaAgent.getStatus()).includes("Active")) { // Check if active
        // A more sophisticated approach would be to parse the query for a code snippet
        // For now, if "advice for code" is present, we'll just note its capability.
        const patterns = bpaAgent.getLearnedPatterns();
        if (patterns.length > 0) {
          agentContributions += `\n[Context from BugPatternAnalysisAgent]:\nLearned Bug Patterns:\n - ${patterns.join("\n - ")}\n`;
        }
        // If a code snippet was extractable, we could call:
        // const advice = await bpaAgent.getContextualAdvice(snippet);
        // agentContributions += `\nBugPatternAnalysisAgent advice: ${advice}\n`;
      }
    }

    // 2. Check if query relates to understanding a specific file/module
    const fileUnderstandQueryMatch = query.match(/understand(?: file)? ([\w\/.-]+)/i);
    if (fileUnderstandQueryMatch && fileUnderstandQueryMatch[1]) {
      const filePath = fileUnderstandQueryMatch[1];
      const cuAgent = this.specializedAgents.get(SpecializedAgentType.CodebaseUnderstanding) as CodebaseUnderstandingAgent | undefined;
      if (cuAgent && (await cuAgent.getStatus()).includes("Active")) {
        const insight = await cuAgent.provideContextForFile(filePath);
        agentContributions += `\n[Context from CodebaseUnderstandingAgent for ${filePath}]:\n${insight}\n`;
      }
    }

    // Add agent contributions to the main query for the LLM, if any
    if (agentContributions) {
      enrichedQuery = `${query}\n\nRelevant information from specialized agents:\n${agentContributions}`;
      console.log("LLMResearcher: Enriched query with agent contributions.");
    }

    try {
      const llmResponse = await this.llmComms.sendMessage(enrichedQuery, systemPrompt);

      await this.saveResearcherData({ lastQuery: query, lastResponseTimestamp: new Date().toISOString(), enrichedQueryProvided: !!agentContributions });

      // TODO: Post-process LLM response, potentially trigger tools or other agents based on response.
      // For example, if LLM suggests analyzing a file, it could auto-task ProactiveBugFinder.
      return llmResponse;
    } catch (error) {
      console.error("Error processing query in LLMResearcher:", error);
      return "Sorry, I encountered an error trying to process your request.";
    }
  }

  public async invokeTool(toolCommand: string): Promise<string> {
    // Example: !search some_function_name
    // Example: !file src/main.c --lines 10-20
    console.log(`Researcher attempting to invoke tool: ${toolCommand}`);

    const [command, ...args] = toolCommand.split(' ');
    const commandName = command.startsWith('!') ? command.substring(1) : command;

    // TODO: Integrate properly with chromium-helper-cli's command execution
    // This is a very simplified placeholder.
    // In reality, you'd map `commandName` and `args` to actual functions/API calls
    // of the chromium-helper-cli.

    // Basic argument parsing for demonstration. A real CLI might use a library like yargs.
    // Example: !search "foo bar" -l cpp --limit 10
    //          commandName = search, queryArg = "foo bar", options = { l: "cpp", limit: "10" }
    let queryArg = "";
    const options: Record<string, string | boolean> = {};
    let currentOptionKey: string | null = null;
    const remainingArgs:string[] = [];

    // Simple parser: assumes options like -l <value> or --option <value> or --flag
    // and the main query argument is the first non-option part.
    // This is a simplified parser. For complex scenarios, a dedicated library would be better.

    let mainArg = "";
    const commandArgs = [...args]; // Clone args to safely manipulate

    // Extract main argument (query, filepath, ID), which is typically the first non-option.
    // Handle quoted main arguments first.
    if (commandArgs.length > 0) {
        if ((commandArgs[0].startsWith('"') && commandArgs[0].endsWith('"')) ||
            (commandArgs[0].startsWith("'") && commandArgs[0].endsWith("'"))) {
            mainArg = commandArgs.shift()!.slice(1, -1);
        } else if (commandArgs[0].startsWith('"')) {
            let currentQuery = commandArgs.shift()!.slice(1);
            while (commandArgs.length > 0 && !commandArgs[0].endsWith('"')) {
                currentQuery += " " + commandArgs.shift();
            }
            if (commandArgs.length > 0 && commandArgs[0].endsWith('"')) {
                currentQuery += " " + commandArgs.shift()!.slice(0, -1);
            }
            mainArg = currentQuery;
        } else if (!commandArgs[0].startsWith("-")) {
             mainArg = commandArgs.shift()!;
        }
    }

    // Process remaining arguments for options
    for (let i = 0; i < commandArgs.length; i++) {
        const arg = commandArgs[i];
        if (arg.startsWith('--')) {
            const optionName = arg.substring(2);
            if (i + 1 < commandArgs.length && !commandArgs[i+1].startsWith('-')) {
                options[optionName] = commandArgs[i+1];
                i++;
            } else {
                options[optionName] = true;
            }
        } else if (arg.startsWith('-')) {
            const optionChar = arg.substring(1);
            if (i + 1 < commandArgs.length && !commandArgs[i+1].startsWith('-')) {
                options[optionChar] = commandArgs[i+1];
                i++;
            } else {
                options[optionChar] = true;
            }
        } else {
            // If it's not an option, and mainArg is not set yet (e.g. options came first)
            if (!mainArg) mainArg = arg;
            else remainingArgs.push(arg); // Or treat as part of a subcommand's arguments
        }
    }
    // For commands like 'cl', the 'mainArg' is the CL number, and 'remainingArgs' might hold subcommand + its options
    // This part still needs more robust parsing for subcommands.

    try {
      switch (commandName) {
        case 'search':
          if (!mainArg) return "Usage: !search <query> [options like -l lang, --limit N]";
          const searchResults = await this.chromiumApi.searchCode({
            query: mainArg,
            language: options.l as string || options.language as string,
            limit: options.limit ? parseInt(options.limit as string) : undefined,
            caseSensitive: !!(options.c || options['case-sensitive']),
            filePattern: options.p as string || options['file-pattern'] as string,
          });
          return `Search Results for "${mainArg}":\n${JSON.stringify(searchResults.slice(0,5), null, 2)}\n(Found ${searchResults.length} results, showing first 5 if available)`;

        case 'file':
          if (!mainArg) return "Usage: !file <filepath> [--start N --end M]";
          const fileResult = await this.chromiumApi.getFile({
            filePath: mainArg,
            lineStart: options.start ? parseInt(options.start as string) : undefined,
            lineEnd: options.end ? parseInt(options.end as string) : undefined,
          });
          return `File: ${fileResult.filePath} (Lines: ${fileResult.displayedLines}/${fileResult.totalLines})\n${fileResult.content}\nBrowser URL: ${fileResult.browserUrl}`;

        case 'issue':
            if (!mainArg) return "Usage: !issue <id_or_url>";
            const issueResult = await this.chromiumApi.getIssue(mainArg);
            return `Issue ${issueResult.issueId}:\nTitle: ${issueResult.title}\nStatus: ${issueResult.status}\nURL: ${issueResult.browserUrl}\nDescription (partial):\n${(issueResult.description || issueResult.comments?.[0]?.content || 'N/A').substring(0,300)}...`;

        case 'cl': // Example: !cl <cl_number_or_url> diff --file "path/to/file.cc"
            if (!mainArg) return "Usage: !cl <cl_number_or_url> [status|diff|comments|file|bots] [options]";
            // Subcommand is now in remainingArgs[0] if present, options follow.
            const subCommand = remainingArgs.length > 0 ? remainingArgs.shift()! : 'status';

            // Re-parse options for the subcommand from remainingArgs
            const subOptions: Record<string, string | boolean> = {};
            for (let i = 0; i < remainingArgs.length; i++) {
                const arg = remainingArgs[i];
                 if (arg.startsWith('--')) {
                    const optionName = arg.substring(2);
                    if (i + 1 < remainingArgs.length && !remainingArgs[i+1].startsWith('-')) {
                        subOptions[optionName] = remainingArgs[i+1]; i++; }
                    else { subOptions[optionName] = true; }
                } else if (arg.startsWith('-')) {
                    const optionChar = arg.substring(1);
                    if (i + 1 < remainingArgs.length && !remainingArgs[i+1].startsWith('-')) {
                        subOptions[optionChar] = remainingArgs[i+1]; i++; }
                    else { subOptions[optionChar] = true; }
                }
            }

            switch(subCommand) {
                case 'status':
                    const status = await this.chromiumApi.getGerritCLStatus(mainArg);
                    return `CL ${status.id} Status: ${status.status}\nSubject: ${status.subject}\nUpdated: ${status.updated}`;
                case 'diff':
                    const diff = await this.chromiumApi.getGerritCLDiff({
                        clNumber: mainArg,
                        filePath: subOptions.file as string, // Use subOptions
                        patchset: subOptions.patchset ? parseInt(subOptions.patchset as string) : undefined
                    });
                    return `CL ${diff.clId} Diff (Patchset ${diff.patchset}):\nShowing ${diff.filePath ? 'file ' + diff.filePath : Object.keys(diff.filesData || {}).length + ' changed files'}\n${diff.diffData ? JSON.stringify(diff.diffData.content.slice(0,3), null, 2) + "\n..." : "No specific file diff requested or available." }`;
                // Add more cl subcommands: comments, file, bots
                default:
                    return `Unknown CL subcommand: ${subCommand}. Available: status, diff. Original args for cl: ${args.join(" ")}`;
            }

        // Add more tool mappings here for other ChromiumAPI methods
        default:
          return `Unknown tool command: ${commandName}. Available tools: search, file, issue, cl.`;
      }
    } catch (error) {
        console.error(`Error invoking tool ${commandName}:`, error);
        return `Error invoking tool ${commandName}: ${(error as Error).message}`;
    }
  }

  // --- Specialized Agent Management ---
  public async startAgent(agentType: SpecializedAgentType): Promise<string> {
    const agent = this.specializedAgents.get(agentType);
    if (agent) {
      await agent.start();
      return `${agentType} started.`;
    }
    return `Agent type ${agentType} not found.`;
  }

  public async stopAgent(agentType: SpecializedAgentType): Promise<string> {
    const agent = this.specializedAgents.get(agentType);
    if (agent) {
      await agent.stop();
      return `${agentType} stopped.`;
    }
    return `Agent type ${agentType} not found.`;
  }

  public async getAgentStatus(agentIdOrType: SpecializedAgentType | string): Promise<string> {
    // Check if it's a generic task ID first
    if (this.runningGenericTasks.has(agentIdOrType)) {
      const agent = this.runningGenericTasks.get(agentIdOrType);
      return agent!.getStatus(); // agent is guaranteed to be there due to .has() check
    }
    // Otherwise, assume it's a SpecializedAgentType
    const agent = this.specializedAgents.get(agentIdOrType as SpecializedAgentType);
    if (agent) {
      return agent.getStatus();
    }
    return `Agent type or ID '${agentIdOrType}' not found.`;
  }

  public async getResearcherStatus(): Promise<string> {
    let status = "LLM Researcher Status:\n";
    status += `- LLM Communication: ${this.llmComms ? 'Initialized' : 'Not Initialized'}\n`;
    status += `- Persistent Storage: ${this.storage ? 'Initialized' : 'Not Initialized'}\n`;

    status += "\n--- Predefined Specialized Agents ---\n";
    if (this.specializedAgents.size === 0) {
      status += "  No predefined specialized agents initialized.\n";
    } else {
      for (const [type, agent] of this.specializedAgents) {
        status += `  - ${type}: ${await agent.getStatus()}\n`;
      }
    }

    status += "\n--- Running/Completed Generic Tasks ---\n";
    if (this.runningGenericTasks.size === 0) {
      status += "  No generic tasks currently active or completed this session.\n";
    } else {
      for (const [id, agent] of this.runningGenericTasks) {
        status += `  - ID ${id}: ${await agent.getStatus()}\n`;
      }
    }
    return status;
  }


  // TODO: Add methods for:
  // - Dynamically creating agents (more complex)
  // - More sophisticated interaction with specialized agents (e.g., tasking, data retrieval)

  // --- Generic Task Agent Management ---
  private runningGenericTasks: Map<string, GenericTaskAgent> = new Map();

  public async createAndRunGenericTask(config: GenericTaskAgentConfig): Promise<string> {
    if (!config.taskDescription || !config.llmPrompt) {
      return "Error: Generic task config must include 'taskDescription' and 'llmPrompt'.";
    }

    const agent = new GenericTaskAgent(this.llmComms, config);
    this.runningGenericTasks.set(agent.id, agent);

    // Not awaiting start here, as it's a one-shot execution.
    // The user can check status using !agent-status <GenericTaskAgentID>
    agent.start().then(() => {
      console.log(`GenericTaskAgent [${agent.id}] execution finished.`);
      // Optionally, could have a callback or event system here if the researcher needs to be actively notified.
      // For now, results are polled via getAgentStatus or a specific getTaskResult command.
    }).catch(e => {
        console.error(`Error during GenericTaskAgent [${agent.id}] execution: `, e);
    });

    return `GenericTaskAgent [${agent.id}] created and started for task: "${config.taskDescription}". Check status with !agent-status ${agent.id}`;
  }

  public async getGenericTaskResult(taskId: string): Promise<string> {
    const agent = this.runningGenericTasks.get(taskId);
    if (!agent) {
      return `No generic task found with ID: ${taskId}`;
    }
    // Ensure it's a GenericTaskAgent, though map storage implies it.
    if (!(agent instanceof GenericTaskAgent)) {
        return `Agent ${taskId} is not a GenericTaskAgent.`;
    }

    const status = await agent.getStatus();
    if (status.includes("Active/Running")) {
      return `Task ${taskId} is still running.`;
    }
    const result = agent.getResult();
    const error = agent.getError();

    if (error) {
      return `Task ${taskId} failed: ${error}`;
    }
    if (result !== null) {
      return `Task ${taskId} completed. Result:\n${result}`;
    }
    return `Task ${taskId} status: ${status}. No result yet, or task did not produce one.`;
  }
}
