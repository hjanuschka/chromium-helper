// For the specialized agents
import { LLMCommunication } from './llm_communication.js';
import { PersistentStorage } from './persistent_storage.js';
import { ChromiumAPI, SearchResult } from '../api.js'; // Import ChromiumAPI and relevant types

export enum SpecializedAgentType {
  ProactiveBugFinding = "ProactiveBugFinding",
  BugPatternAnalysis = "BugPatternAnalysis",
  CodebaseUnderstanding = "CodebaseUnderstanding",
  GenericTask = "GenericTask", // Added for generic agents
}

export interface SpecializedAgent {
  type: SpecializedAgentType;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<string>;
  // Potentially a method to receive tasks or data from the main researcher
  processData?(data: unknown): Promise<void>;
}

export class ProactiveBugFinder implements SpecializedAgent {
  public type = SpecializedAgentType.ProactiveBugFinding;
  private llmComms: LLMCommunication;
  private storage: PersistentStorage;
  private chromiumApi: ChromiumAPI;
  private isActive: boolean = false;
  private lastAnalysisTimestamp?: Date;

  constructor(llmComms: LLMCommunication, chromiumApi: ChromiumAPI) {
    this.llmComms = llmComms;
    this.chromiumApi = chromiumApi;
    this.storage = new PersistentStorage('ProactiveBugFinder_data');
    console.log("Proactive Bug Finder agent initialized with ChromiumAPI access.");
    this.loadState();
  }

  private async loadState(): Promise<void> {
    const state = await this.storage.loadData<{ lastAnalysis?: string }>();
    if (state && state.lastAnalysis) {
      this.lastAnalysisTimestamp = new Date(state.lastAnalysis);
      console.log(`ProactiveBugFinder: Loaded state, last analysis on ${this.lastAnalysisTimestamp}`);
    }
  }

  private async saveState(): Promise<void> {
    await this.storage.saveData({ lastAnalysis: this.lastAnalysisTimestamp?.toISOString() });
  }

  public async start(): Promise<void> {
    if (this.isActive) {
      console.log("Proactive Bug Finder is already active.");
      return;
    }
    this.isActive = true;
    console.log("Proactive Bug Finder agent started.");
    // In a real scenario, this might kick off a loop or subscribe to events
    // For now, let's simulate a one-off task
    this.runAnalysisCycle();
  }

  public async stop(): Promise<void> {
    this.isActive = false;
    console.log("Proactive Bug Finder agent stopped.");
  }

  public async getStatus(): Promise<string> {
    let status = `Proactive Bug Finder: ${this.isActive ? 'Active' : 'Idle'}.`;
    if (this.lastAnalysisTimestamp) {
      status += ` Last analysis: ${this.lastAnalysisTimestamp.toLocaleString()}`;
    }
    return status;
  }

  private async runAnalysisCycle(): Promise<void> {
    if (!this.isActive) return;

    console.log("ProactiveBugFinder: Starting new analysis cycle...");
    // TODO: Implement actual bug finding logic.
    // This would involve:
    // 1. Identifying target code (new APIs, hotspots, etc.)
    //    Example: Search for new Mojo APIs or files modified recently in sensitive directories.
    let targetFiles: SearchResult[] = [];
    try {
      targetFiles = await this.chromiumApi.searchCode({
        query: 'interface.mojom', // Example: look for mojom files
        filePattern: 'third_party/blink/public/mojom/', // Example: in a specific path
        limit: 5,
      });
      console.log(`ProactiveBugFinder: Found ${targetFiles.length} potential target files for analysis.`);
    } catch (e) {
      console.error("ProactiveBugFinder: Error searching for target files:", e);
      this.lastAnalysisTimestamp = new Date(); // Still update timestamp to avoid immediate retry on error
      await this.saveState();
      return;
    }

    if (targetFiles.length === 0) {
      console.log("ProactiveBugFinder: No specific target files found in this cycle. Will try a general prompt.");
      const generalPrompt = "Describe a subtle but critical vulnerability pattern that might be overlooked in a large C++ codebase like Chromium, focusing on inter-process communication or complex state management. Provide a hypothetical code example of such a pattern.";
      const generalAnalysis = await this.llmComms.sendMessage(generalPrompt, "You are a security researcher brainstorming potential vulnerabilities.");
      console.log("ProactiveBugFinder (General Brainstorming):", generalAnalysis.substring(0, 200) + "...");
      this.lastAnalysisTimestamp = new Date();
      await this.saveState();
      console.log("ProactiveBugFinder: General analysis cycle complete.");
      return;
    }

    // 2. Fetching code content for the first found file (example)
    // 3. Analyzing code with LLM
    for (const targetFile of targetFiles.slice(0, 1)) { // Analyze first file for demo
      try {
        console.log(`ProactiveBugFinder: Analyzing ${targetFile.file}...`);
        const fileData = await this.chromiumApi.getFile({ filePath: targetFile.file });

        const analysisPrompt = `Analyze the following code from ${targetFile.file} for potential security vulnerabilities, focusing on issues like use-after-free, race conditions, or improper input validation related to its likely purpose (e.g., a Mojo interface). Pay attention to any new or complex patterns. Code:\n\n${fileData.content.substring(0, 4000)}\n\nWhat are potential risks or areas needing closer inspection?`;

        const llmAnalysis = await this.llmComms.sendMessage(
          analysisPrompt,
          "You are a security code auditor. Provide a concise analysis of potential risks."
        );
        console.log(`ProactiveBugFinder (Analysis for ${targetFile.file}):\n${llmAnalysis}`);
        // TODO: Store findings or report back more formally
      } catch (e) {
        console.error(`ProactiveBugFinder: Error analyzing file ${targetFile.file}:`, e);
      }
    }

    this.lastAnalysisTimestamp = new Date();
    await this.saveState();
    console.log("ProactiveBugFinder: Targeted analysis cycle complete.");

    // If it were a continuous agent, it might schedule its next run here
    // setTimeout(() => this.runAnalysisCycle(), 3600 * 1000); // e.g., run every hour
  }

  // Example method that could be called by the main researcher
  public async analyzeSpecificFile(filePath: string): Promise<string> {
    if (!this.isActive) return "Agent is not active.";
    if (!this.chromiumApi) return "ProactiveBugFinder: ChromiumAPI not available.";

    console.log(`ProactiveBugFinder: Tasked to analyze specific file: ${filePath}`);
    try {
      const fileData = await this.chromiumApi.getFile({ filePath });
      const analysisPrompt = `Analyze the following code from ${filePath} for potential security vulnerabilities. Code:\n\n${fileData.content.substring(0, 4000)}\n\nWhat are potential risks?`;
      const analysis = await this.llmComms.sendMessage(analysisPrompt, "Security code auditor analyzing specific file.");
      return analysis;
    } catch (e) {
      console.error(`ProactiveBugFinder: Error analyzing specific file ${filePath}:`, e);
      return `Error analyzing ${filePath}: ${(e as Error).message}`;
    }
  }
}

// TODO: Implement BugPatternAnalysisAgent and CodebaseUnderstandingAgent
// These would follow a similar structure, taking LLMCommunication (and potentially ChromiumAPI)
// and using PersistentStorage.

// Example:
// export class BugPatternAnalysisAgent implements SpecializedAgent { ... }
// export class CodebaseUnderstandingAgent implements SpecializedAgent { ... }


export class BugPatternAnalysisAgent implements SpecializedAgent {
  public type = SpecializedAgentType.BugPatternAnalysis;
  private llmComms: LLMCommunication;
  private storage: PersistentStorage;
  private chromiumApi: ChromiumAPI; // For fetching patch details, code related to bugs
  private isActive: boolean = false;
  private lastPatternExtraction?: Date;
  private learnedPatterns: string[] = [];

  constructor(llmComms: LLMCommunication, chromiumApi: ChromiumAPI) {
    this.llmComms = llmComms;
    this.chromiumApi = chromiumApi;
    this.storage = new PersistentStorage('BugPatternAnalysis_data');
    console.log("Bug Pattern Analysis agent initialized with ChromiumAPI access.");
    this.loadState();
  }

  private async loadState(): Promise<void> {
    const state = await this.storage.loadData<{ lastExtraction?: string; patterns?: string[] }>();
    if (state) {
      if (state.lastExtraction) {
        this.lastPatternExtraction = new Date(state.lastExtraction);
        console.log(`BugPatternAnalysisAgent: Loaded state, last pattern extraction on ${this.lastPatternExtraction}`);
      }
      if (state.patterns) {
        this.learnedPatterns = state.patterns;
        console.log(`BugPatternAnalysisAgent: Loaded ${this.learnedPatterns.length} learned patterns.`);
      }
    }
  }

  private async saveState(): Promise<void> {
    await this.storage.saveData({
      lastExtraction: this.lastPatternExtraction?.toISOString(),
      patterns: this.learnedPatterns
    });
  }

  public async start(): Promise<void> {
    if (this.isActive) {
      console.log("Bug Pattern Analysis agent is already active.");
      return;
    }
    this.isActive = true;
    console.log("Bug Pattern Analysis agent started.");
    this.runPatternExtractionCycle(); // Simulate a one-off task
  }

  public async stop(): Promise<void> {
    this.isActive = false;
    console.log("Bug Pattern Analysis agent stopped.");
  }

  public async getStatus(): Promise<string> {
    let status = `Bug Pattern Analysis: ${this.isActive ? 'Active' : 'Idle'}.`;
    status += ` ${this.learnedPatterns.length} patterns learned.`;
    if (this.lastPatternExtraction) {
      status += ` Last extraction: ${this.lastPatternExtraction.toLocaleString()}`;
    }
    return status;
  }

  private async runPatternExtractionCycle(): Promise<void> {
    if (!this.isActive) return;

    console.log("BugPatternAnalysisAgent: Starting new pattern extraction cycle...");
    // TODO: Implement actual pattern extraction logic.
    // This would involve:
    // 1. Identifying sources of bug reports/patches
    let relevantCommits: any[] = [];
    try {
      const commitResults = await this.chromiumApi.searchCommits({
        query: 'fix security vulnerability OR cve-', // Example query
        limit: 3,
      });
      relevantCommits = commitResults.log || [];
      console.log(`BugPatternAnalysisAgent: Found ${relevantCommits.length} potentially relevant commits.`);
    } catch (e) {
      console.error("BugPatternAnalysisAgent: Error searching for commits:", e);
      this.lastPatternExtraction = new Date();
      await this.saveState();
      return;
    }

    if (relevantCommits.length === 0) {
      console.log("BugPatternAnalysisAgent: No relevant commits found in this cycle.");
      this.lastPatternExtraction = new Date();
      await this.saveState();
      return;
    }

    // 2. Fetching relevant data (e.g., commit message) and 3. Analyzing with LLM
    for (const commit of relevantCommits.slice(0,1)) { // Analyze one commit for demo
      try {
        console.log(`BugPatternAnalysisAgent: Analyzing commit ${commit.commit} - ${commit.message.substring(0,50)}...`);
        // In a real scenario, you might fetch diffs if it's a Gerrit CL using:
        // if (commit.gerritChangeId) {
        //   const diffData = await this.chromiumApi.getGerritCLDiff({ clNumber: commit.gerritChangeId });
        //   // ... use diffData.diff ...
        // }

        const analysisPrompt = `Analyze the following commit message for a security patch in Chromium. What was the likely vulnerability type, root cause, and what generalizable pattern can be extracted from this fix?\n\nCommit Message:\n${commit.message}\n\nAuthor: ${commit.author.name} <${commit.author.email}>\nDate: ${commit.committer.time}`;

        const llmAnalysis = await this.llmComms.sendMessage(
          analysisPrompt,
          "You are a security researcher specializing in vulnerability patterns from commit analysis."
        );
        console.log(`BugPatternAnalysisAgent (Pattern from commit ${commit.commit.substring(0,10)}):\n${llmAnalysis}`);

        const newPattern = `Pattern from commit ${commit.commit.substring(0,7)} (${new Date(commit.committer.time).toLocaleDateString()}): ${llmAnalysis.substring(0, 100)}...`;
        this.learnedPatterns.push(newPattern);
        if (this.learnedPatterns.length > 20) this.learnedPatterns.shift();

      } catch (e) {
        console.error(`BugPatternAnalysisAgent: Error analyzing commit ${commit.commit}:`, e);
      }
    }

    this.lastPatternExtraction = new Date();
    await this.saveState();
    console.log("BugPatternAnalysisAgent: Pattern extraction cycle complete.");
  }

  public getLearnedPatterns(): string[] {
    return [...this.learnedPatterns];
  }

  // This method could be called by ProactiveBugFinder or LLMResearcher
  public async getContextualAdvice(codeSnippet: string): Promise<string> {
    if (!this.chromiumApi) return "BugPatternAnalysisAgent: ChromiumAPI not available.";
    if (this.learnedPatterns.length === 0) {
      return "No bug patterns learned yet to provide advice.";
    }
    // Potentially use chromiumApi to get more context about the code snippet if needed
    const prompt = `Given the following code snippet:\n\`\`\`cpp\n${codeSnippet}\n\`\`\`\n\nAnd considering these learned bug patterns:\n${this.learnedPatterns.join("\n - ")}\n\nProvide contextual advice or point out potential risks based on the patterns. If no specific pattern matches, say so.`;

    return this.llmComms.sendMessage(prompt, "You are a security advisor. Help identify risks based on past bug patterns.");
  }
}


export class CodebaseUnderstandingAgent implements SpecializedAgent {
  public type = SpecializedAgentType.CodebaseUnderstanding;
  private llmComms: LLMCommunication;
  private storage: PersistentStorage;
  private chromiumApi: ChromiumAPI; // For fetching code, searching symbols, etc.
  private isActive: boolean = false;
  private lastModuleAnalysis?: Date;
  private codebaseInsights: Map<string, string> = new Map(); // modulePath -> insightSummary

  constructor(llmComms: LLMCommunication, chromiumApi: ChromiumAPI) {
    this.llmComms = llmComms;
    this.chromiumApi = chromiumApi;
    this.storage = new PersistentStorage('CodebaseUnderstanding_data');
    console.log("Codebase Understanding agent initialized with ChromiumAPI access.");
    this.loadState();
  }

  private async loadState(): Promise<void> {
    const state = await this.storage.loadData<{ lastAnalysis?: string; insights?: [string, string][] }>();
    if (state) {
      if (state.lastAnalysis) {
        this.lastModuleAnalysis = new Date(state.lastAnalysis);
        console.log(`CodebaseUnderstandingAgent: Loaded state, last module analysis on ${this.lastModuleAnalysis}`);
      }
      if (state.insights) {
        this.codebaseInsights = new Map(state.insights);
        console.log(`CodebaseUnderstandingAgent: Loaded ${this.codebaseInsights.size} codebase insights.`);
      }
    }
  }

  private async saveState(): Promise<void> {
    await this.storage.saveData({
      lastAnalysis: this.lastModuleAnalysis?.toISOString(),
      insights: Array.from(this.codebaseInsights.entries())
    });
  }

  public async start(): Promise<void> {
    if (this.isActive) {
      console.log("Codebase Understanding agent is already active.");
      return;
    }
    this.isActive = true;
    console.log("Codebase Understanding agent started.");
    this.runModuleAnalysisCycle(); // Simulate a one-off task
  }

  public async stop(): Promise<void> {
    this.isActive = false;
    console.log("Codebase Understanding agent stopped.");
  }

  public async getStatus(): Promise<string> {
    let status = `Codebase Understanding: ${this.isActive ? 'Active' : 'Idle'}.`;
    status += ` ${this.codebaseInsights.size} insights gathered.`;
    if (this.lastModuleAnalysis) {
      status += ` Last module analysis: ${this.lastModuleAnalysis.toLocaleString()}`;
    }
    return status;
  }

  private async runModuleAnalysisCycle(): Promise<void> {
    if (!this.isActive) return;

    console.log("CodebaseUnderstandingAgent: Starting new module analysis cycle...");
    // TODO: Implement actual codebase analysis logic.
    // This would involve:
    // 1. Identifying target modules/areas of the codebase
    const targetModulePath = "src/components/safe_browsing"; // Example target
    let moduleFiles: SearchResult[] = [];
    try {
      moduleFiles = await this.chromiumApi.searchCode({
        query: `file:${targetModulePath}/.*\\.cc`, // Search for .cc files in the module
        limit: 3, // Analyze a few files for demo
      });
      console.log(`CodebaseUnderstandingAgent: Found ${moduleFiles.length} files in module ${targetModulePath}.`);
    } catch (e) {
      console.error(`CodebaseUnderstandingAgent: Error searching for files in ${targetModulePath}:`, e);
      this.lastModuleAnalysis = new Date();
      await this.saveState();
      return;
    }

    if (moduleFiles.length === 0) {
      console.log(`CodebaseUnderstandingAgent: No files found in ${targetModulePath} for analysis this cycle.`);
      this.lastModuleAnalysis = new Date();
      await this.saveState();
      return;
    }

    // 2. Fetching code and 3. Analyzing with LLM
    let collectiveInsights = `Insights for module: ${targetModulePath}\n`;
    for (const file of moduleFiles) {
      try {
        console.log(`CodebaseUnderstandingAgent: Analyzing file ${file.file}...`);
        const fileData = await this.chromiumApi.getFile({ filePath: file.file });
        // Limit content sent to LLM for brevity/cost
        const contentSample = fileData.content.split('\n').slice(0, 100).join('\n');

        const analysisPrompt = `Based on the following code from ${file.file} (part of the ${targetModulePath} module), briefly summarize its main purpose and typical interactions. Focus on high-level understanding.\n\nCODE SAMPLE (first 100 lines):\n${contentSample}\n\nSUMMARY:`;

        const llmSummary = await this.llmComms.sendMessage(
          analysisPrompt,
          "You are a senior software engineer summarizing a C++ file's purpose within a larger module."
        );
        collectiveInsights += `\nFile: ${file.file}\nSummary: ${llmSummary}\n`;
        console.log(`CodebaseUnderstandingAgent (Summary for ${file.file}): ${llmSummary.substring(0,100)}...`);
      } catch (e) {
        console.error(`CodebaseUnderstandingAgent: Error analyzing file ${file.file}:`, e);
      }
    }

    this.codebaseInsights.set(targetModulePath, collectiveInsights.substring(0, 5000)); // Store collective summary
    if (this.codebaseInsights.size > 50) {
        const firstKey = this.codebaseInsights.keys().next().value;
        if(firstKey) this.codebaseInsights.delete(firstKey);
    }

    this.lastModuleAnalysis = new Date();
    await this.saveState();
    console.log("CodebaseUnderstandingAgent: Module analysis cycle complete.");
  }

  public getInsightForModule(modulePath: string): string | undefined {
    // Try exact match first, then parent directory match
    if (this.codebaseInsights.has(modulePath)) {
        return this.codebaseInsights.get(modulePath);
    }
    const parentKey = Array.from(this.codebaseInsights.keys()).find(k => modulePath.startsWith(k));
    return parentKey ? this.codebaseInsights.get(parentKey) : undefined;
  }

  // This method could be used by ProactiveBugFinder or LLMResearcher
  public async provideContextForFile(filePath: string, codeSnippet?: string): Promise<string> {
    if (!this.chromiumApi) return "CodebaseUnderstandingAgent: ChromiumAPI not available.";

    let contextPrompt = `Provide a brief understanding of the file '${filePath}' in the Chromium codebase. `;
    const knownInsight = this.getInsightForModule(filePath); // Use updated getter

    if (knownInsight) {
      contextPrompt += `\nI have this existing insight about its module/area: "${knownInsight.substring(0, 500)}...".\n`;
    }

    // Fetch a snippet of the actual file if not provided
    let actualCodeSnippet = codeSnippet;
    if (!actualCodeSnippet) {
        try {
            const fileData = await this.chromiumApi.getFile({filePath, lineStart: 1, lineEnd: 50});
            actualCodeSnippet = fileData.content;
            contextPrompt += `\nHere are the first 50 lines of ${filePath}:\n\`\`\`cpp\n${actualCodeSnippet}\n\`\`\`\n`;
        } catch (e) {
            console.warn(`CodebaseUnderstandingAgent: Could not fetch snippet for ${filePath}: ${(e as Error).message}`);
        }
    } else {
         contextPrompt += `Consider this specific snippet from the file:\n\`\`\`cpp\n${codeSnippet}\n\`\`\`\n`;
    }

    contextPrompt += `What are its likely responsibilities, interactions, and common security considerations for code in this area?`;

    return this.llmComms.sendMessage(contextPrompt, "You are a Chromium codebase expert. Provide concise understanding based on available information and the code snippet.");
  }
}


// --- Generic Task Agent for "Dynamic" Task Execution ---
let genericTaskAgentIdCounter = 0;

export interface GenericTaskAgentConfig {
  id?: string; // Optional, will be generated if not provided
  taskDescription: string;
  llmPrompt: string; // The prompt the LLM will use to execute the task's core logic
  // Optionally, could include target files/data sources if it needs to interact with ChromiumAPI
}

export class GenericTaskAgent implements SpecializedAgent {
  public type = SpecializedAgentType.GenericTask;
  public id: string;
  private llmComms: LLMCommunication;
  private config: GenericTaskAgentConfig & { id: string }; // Ensure id is present after construction
  private isActive: boolean = false;
  private result: string | null = null;
  private error: string | null = null;

  constructor(llmComms: LLMCommunication, config: GenericTaskAgentConfig) {
    this.id = config.id || `generic-task-${++genericTaskAgentIdCounter}`;
    this.llmComms = llmComms;
    this.config = { ...config, id: this.id }; // Ensure ID is set
    console.log(`GenericTaskAgent [${this.id}] initialized for task: ${this.config.taskDescription}`);
  }

  async start(): Promise<void> {
    if (this.isActive) {
      console.warn(`GenericTaskAgent [${this.id}] is already active.`);
      return;
    }
    this.isActive = true;
    this.result = null;
    this.error = null;
    console.log(`GenericTaskAgent [${this.id}] started.`);

    try {
      // The "task" is essentially executing the configured LLM prompt.
      // A more complex generic agent might perform other actions before/after based on config.
      this.result = await this.llmComms.sendMessage(this.config.llmPrompt, `Executing task: ${this.config.taskDescription}`);
      console.log(`GenericTaskAgent [${this.id}] completed. Result preview: ${(this.result || "").substring(0, 100)}...`);
    } catch (e) {
      const err = e as Error;
      this.error = err.message;
      console.error(`GenericTaskAgent [${this.id}] failed: ${this.error}`);
    } finally {
      this.isActive = false; // Typically, generic tasks are one-shot
    }
  }

  async stop(): Promise<void> {
    // For a one-shot task agent, stop might not do much if it's already completed or failed.
    // If it were a long-running generic task, this would be more relevant.
    this.isActive = false;
    console.log(`GenericTaskAgent [${this.id}] stopped (or was already inactive).`);
  }

  async getStatus(): Promise<string> {
    let status = `GenericTaskAgent [${this.id}] (${this.config.taskDescription}): `;
    if (this.isActive) {
      status += "Active/Running.";
    } else if (this.result !== null) {
      status += `Completed. Result: ${(this.result || "").substring(0,50)}...`;
    } else if (this.error !== null) {
      status += `Failed. Error: ${this.error}`;
    } else {
      status += "Idle/Pending.";
    }
    return status;
  }

  public getResult(): string | null {
    return this.result;
  }

  public getError(): string | null {
    return this.error;
  }
}
