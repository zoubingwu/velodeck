import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  ExecuteSQL,
  GetAIProviderSettings,
  GetDatabaseMetadata,
  GetVersion,
  UpdateAIDescription,
} from "@/bridge";
import {
  type CoreMessage,
  type Tool,
  type ToolCallPart,
  type ToolResultPart,
  generateObject,
  generateText,
  streamText,
  tool,
} from "ai";
import { z } from "zod";
import type { services } from "@/bridge";

export const AVAILABLE_MODELS = {
  openai: [
    "o1",
    "o1-mini",
    "gpt-4.1",
    "gpt-4",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-3.5-turbo",
  ].sort(),
  anthropic: [
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
  openrouter: [
    "openai/gpt-4.1",
    "openai/gpt-4o",
    "google/gemini-2.5-pro-preview",
    "google/gemini-2.5-flash-preview",
    "anthropic/claude-opus-4",
    "anthropic/claude-sonnet-4",
    "anthropic/claude-3.7-sonnet",
    "anthropic/claude-3.5-sonnet",
    "deepseek/deepseek-r1",
  ].sort(),
};

const createModel = async (options?: ProviderConnectionOptions) => {
  const aiProviderSettings = await GetAIProviderSettings();
  const provider = options?.provider || aiProviderSettings.provider;

  if (!provider) {
    throw new Error(
      "AI provider is not configured. Please select a provider and add the API key in Preferences.",
    );
  }

  if (provider === "openai") {
    const apiKey = options?.apiKey || aiProviderSettings.openai?.apiKey;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key is missing. Please add it in Preferences.",
      );
    }
    const openai = createOpenAI({
      apiKey,
      baseURL: options?.baseURL || aiProviderSettings.openai?.baseURL,
    });
    return openai.chat(aiProviderSettings.openai?.model || "gpt-4o");
  }

  if (provider === "anthropic") {
    const apiKey = options?.apiKey || aiProviderSettings.anthropic?.apiKey;
    if (!apiKey) {
      throw new Error(
        "Anthropic API key is missing. Please add it in Preferences.",
      );
    }
    const anthropic = createAnthropic({
      apiKey,
      baseURL: options?.baseURL || aiProviderSettings.anthropic?.baseURL,
    });
    return anthropic.languageModel(
      aiProviderSettings.anthropic?.model || "claude-3-5-sonnet-latest",
    );
  }

  if (provider === "openrouter") {
    const apiKey = options?.apiKey || aiProviderSettings.openrouter?.apiKey;
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key is missing. Please add it in Preferences.",
      );
    }
    const openrouter = createOpenRouter({
      apiKey,
    });
    return openrouter.chat(
      aiProviderSettings.openrouter?.model || "anthropic/claude-3.5-sonnet",
    );
  }

  throw new Error(
    "No AI provider selected or the selected provider is not supported. Please check your Preferences.",
  );
};

type ProviderConnectionOptions = {
  provider?: services.AIProviderSettings["provider"];
  apiKey?: string;
  baseURL?: string;
  model?: string;
};

export const testProviderConnection = async (
  options?: ProviderConnectionOptions,
) => {
  const model = await createModel(options);
  try {
    const { text } = await generateText({
      model,
      prompt: "Hello!",
    });

    return { success: true, message: text };
  } catch (error: any) {
    console.log("Error testing provider connection:", error);
    return { success: false, error: error.message };
  }
};

export const inferConnectionDetails = async (textFromClipboard: string) => {
  const model = await createModel();
  const { object } = await generateObject({
    model,
    prompt: `
    Analyze the following text and extract database connection details. Respond ONLY with a JSON object containing the keys "host", "port", "user", "password", "dbName", and "useTLS" (boolean, true if TLS/SSL is mentioned or implied or it is tidbcloud.com, otherwise false). If a value is not found, use an empty string "" for string fields or false for the boolean.

    Input Text:
    """
    ${textFromClipboard}
    """

    JSON Output:
    `.trim(),
    schema: z.object({
      host: z.string(),
      port: z.string(),
      user: z.string(),
      password: z.string(),
      dbName: z.string(),
      useTLS: z.boolean(),
    }),
  });

  return object;
};

const dbTools = {
  getDatabaseMetadata: tool({
    description:
      "Get complete metadata for a database, including all tables, their schemas, relationships, and other structural information. This is the primary tool for understanding database structure.",
    parameters: z.object({
      dbName: z
        .string()
        .describe("The name of the database to get metadata for"),
    }),
    execute: async ({ dbName }) => {
      try {
        console.log(`Tool Call: getDatabaseMetadata (dbName: ${dbName})`);
        const metadata = await GetDatabaseMetadata();
        console.log("Tool Result: getDatabaseMetadata ->", metadata);
        return { success: true, metadata: metadata.databases[dbName] };
      } catch (error: any) {
        console.error(`Error getting metadata for ${dbName}:`, error);
        return { success: false, error: error.message };
      }
    },
  }),

  getSampleData: tool({
    description:
      "Get sample data from database tables to understand their structure and content. This tool is specifically for data exploration and analysis - it automatically uses LIMIT to get manageable sample sizes. Use this when you need to understand what kind of data a table contains.",
    parameters: z.object({
      dbName: z.string().describe("The name of the database"),
      tableName: z.string().describe("The name of the table to sample"),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Number of sample rows to retrieve (default: 5, max: 20)"),
    }),
    execute: async ({ dbName, tableName, limit = 5 }) => {
      try {
        // Ensure limit is reasonable
        const safeLimit = Math.min(Math.max(limit, 1), 20);
        const query = `SELECT * FROM \`${dbName}\`.\`${tableName}\` LIMIT ${safeLimit}`;

        console.log(
          `Tool Call: getSampleData (dbName: ${dbName}, tableName: ${tableName}, limit: ${safeLimit})`,
        );

        const result = await ExecuteSQL(query);
        console.log("Tool Result: getSampleData ->", result);
        return { success: true, result, query };
      } catch (error: any) {
        console.error(`Error getting sample data:`, error);
        return { success: false, error: error.message };
      }
    },
  }),

  updateAIDescription: tool({
    description:
      "Update AI-generated descriptions for database components (database, table, or column) based on learned information from user interactions. Use this to capture and store insights about the purpose, business logic, or important characteristics of database elements.",
    parameters: z.object({
      dbName: z.string().describe("The name of the database"),
      targetType: z
        .enum(["database", "table", "column"])
        .describe("The type of component to update description for"),
      tableName: z
        .string()
        .optional()
        .describe("Required for table and column types"),
      columnName: z.string().optional().describe("Required for column type"),
      description: z
        .string()
        .describe(
          "The AI-generated description summarizing learned information about this component",
        ),
    }),
    execute: async ({
      dbName,
      targetType,
      tableName = "",
      columnName = "",
      description,
    }) => {
      try {
        console.log(
          `Tool Call: updateAIDescription (dbName: ${dbName}, targetType: ${targetType}, tableName: ${tableName}, columnName: ${columnName})`,
        );
        await UpdateAIDescription(
          dbName,
          targetType,
          tableName,
          columnName,
          description,
        );
        console.log("Tool Result: updateAIDescription -> success");
        return {
          success: true,
          message: `Successfully updated AI description for ${targetType}${
            tableName ? ` ${tableName}` : ""
          }${columnName ? `.${columnName}` : ""}`,
        };
      } catch (error: any) {
        console.error(`Error updating AI description:`, error);
        return { success: false, error: error.message };
      }
    },
  }),
};

// --- Define the type for yielded events from the generator ---
export type AgentStreamEvent =
  | {
      type: "step";
      data: {
        text?: string; // Intermediate text/thought from the LLM
        toolCalls?: ToolCallPart[]; // Requested tool calls
        toolResults?: ToolResultPart[]; // Results from executed tools
        finishReason?: string; // Reason the step finished
      };
    }
  | { type: "error"; error: string }; // An error occurred

// --- The New Agent Generator Function ---
export async function* generateSqlAgent(
  userPrompt: string,
  conversationHistory: CoreMessage[] = [],
  tools: Record<string, Tool> = {},
  abortSignal: AbortSignal,
): AsyncGenerator<AgentStreamEvent, void, unknown> {
  const model = await createModel();
  const metadata = await GetDatabaseMetadata();
  const version = metadata.version || (await GetVersion());

  const agentTools = {
    ...dbTools,
    ...tools,
  };

  const systemPrompt = `
You are an expert database AI assistant, specialized in helping users interact with their database through natural language.

Your primary goal is to understand user queries about their database and provide accurate responses through SQL operations. You can perform CRUD operations on the database or simply answer questions about the database structure and data.

You have access to the complete database schema and can explore relationships between tables. Always try to get the most relevant metadata first if needed using tools.

<database_version>
${version}
</database_version>

<sql_syntax_guidelines>
Based on the database version above, follow these SQL syntax rules:

For TiDB (MySQL-compatible):
- Use backticks (\`) for identifiers (table names, column names)
- Support for JSON data type and JSON functions (JSON_EXTRACT, JSON_SET, etc.)
- Use LIMIT for pagination, supports LIMIT offset, count syntax
- Support for window functions (ROW_NUMBER(), RANK(), etc.)
- Use AUTO_INCREMENT for auto-incrementing primary keys
- DateTime functions: NOW(), CURDATE(), DATE_FORMAT(), etc.
- String functions: CONCAT(), SUBSTRING(), CHAR_LENGTH(), etc.
- Use UTF8MB4 charset for full Unicode support
- Support for CTEs (Common Table Expressions) with WITH clause
- Use ENGINE=InnoDB for transactional tables

For MySQL 5.7+:
- All TiDB features plus MySQL-specific optimizations
- Support for generated columns (VIRTUAL/STORED)
- JSON data type with native JSON functions
- Use FULLTEXT indexes for text search

For MySQL 8.0+:
- Window functions fully supported
- CTEs (WITH RECURSIVE) supported
- Enhanced JSON functions
- Support for invisible columns
- Use utf8mb4_0900_ai_ci collation for better sorting

Always generate SQL that is compatible with the detected database version and avoid using features not available in that version.
</sql_syntax_guidelines>

<database_metadata>
${metadata ? JSON.stringify(Object.values(metadata.databases).map((i) => ({ name: i.name, graph: i.graph }))) : "No database metadata available"}
</database_metadata>

<capabilities>
1. Generate and execute SQL queries based on natural language requests
2. Explain database structure and relationships
3. Analyze data patterns and provide insights
4. Assist with database operations (SELECT, INSERT, UPDATE, DELETE)
5. Learn and store insights about database components through AI descriptions
6. Ensure data safety and validate operations
</capabilities>

<operation_guidelines>
1. Understanding Phase:
   - Analyze the user's request carefully
   - Identify the type of operation needed (read/write)
   - Determine which databases are relevant first
   - Use getDatabaseMetadata to understand the database structure and metadata
   - Determine which tables and columns are relevant
   - Consider potential data relationships and constraints

2. Information Gathering:
   - Use getDatabaseMetadata to understand the database structure and metadata
   - When metadata lacks sufficient context or descriptions are missing, use getSampleData to query sample data
   - getSampleData automatically uses appropriate LIMIT values to get representative examples
   - Analyze sample data to infer table/column purposes, data patterns, and business logic
   - Use getSampleData to validate assumptions and explore table contents

3. Query Generation & Execution:
   **Critical SQL Formatting Rule:** All table names in generated SQL queries MUST be explicitly qualified with their database name (e.g., \`database_name\`.\`table_name\`). For instance, use \`FROM main_db.users\` instead of \`FROM users\`. Refer to the provided \`<database_metadata>\` to identify the correct database names. If the database name is ambiguous or not specified, you should first try to infer it or ask the user for clarification if multiple databases contain similarly named tables.

   For READ operations (SELECT):
   - Generate efficient queries with appropriate JOINs and WHERE clauses
   - Try to use LIMIT when returning large datasets unless the user explicitly asks for all rows or it is required for further analysis
   - Execute directly using executeSql tool

   For WRITE operations (INSERT/UPDATE/DELETE):
   - Use executeSql with requiresConfirmation: true
   - Include clear WHERE clauses for UPDATE/DELETE
   - Provide detailed explanation of the changes
   - The tool will handle user confirmation through the UI

4. Learning and Knowledge Storage:
   - When users provide insights about database components (purpose, business logic, constraints, etc.), use updateAIDescription to store this knowledge
   - When metadata is insufficient, proactively query sample data to understand table/column purposes
   - Analyze sample data patterns to infer:
     * Table purpose (e.g., "user accounts", "order history", "product catalog")
     * Column meanings (e.g., "user_id: unique identifier for users", "created_at: timestamp when record was created")
     * Data patterns and constraints (e.g., "email format validation", "status enum values")
     * Business logic insights (e.g., "soft delete using deleted_at column")
   - Use updateAIDescription to store these inferred insights for future reference
   - Update descriptions for databases, tables, or columns based on learned information
   - This helps build a knowledge base for future interactions
   - Always summarize and store meaningful insights that could help understand the database better

5. Sample Data Analysis Workflow:
   - When encountering tables without AI descriptions, use getSampleData to retrieve sample rows
   - Examine the sample data to understand:
     * What type of entities the table stores
     * The purpose and format of each column
     * Relationships between columns
     * Common patterns or business rules
   - Generate concise, informative descriptions based on the analysis
   - Store the inferred descriptions using updateAIDescription for future reference
</operation_guidelines>

<safety_protocols>
1. Never execute destructive operations without confirmation (handled by executeSql tool)
2. Validate inputs and handle edge cases
3. Use appropriate quoting for identifiers (\`) and strings ('')
4. Include WHERE clauses in UPDATE/DELETE operations
5. Consider the impact on related tables (foreign keys)
</safety_protocols>

<error_handling>
- If request is ambiguous: Ask for clarification
- If request is unsafe: Explain the risks and suggest alternatives
- If request is invalid: Explain why and suggest corrections
</error_handling>

<response_style>
- Provide clear, conversational explanations of what you're doing
- When executing SQL queries, explain the purpose and expected results
- For complex operations, break down the steps
- Always explain any potential risks or important considerations
- Use natural language - you don't need to use any special formatting or tools for your final response
</response_style>

<best_practices>
1. Always validate table and column existence before generating queries
2. Use appropriate SQL syntax for TiDB/MySQL
3. Consider performance implications for large datasets
4. Provide clear explanations for all operations
5. Prioritize data safety and integrity
6. Use tools to gather information and execute queries, then provide natural language explanations
7. Actively learn from user interactions and store insights using updateAIDescription
8. When users explain business logic, constraints, or purposes, capture this knowledge for future reference
9. When encountering tables/columns without descriptions, use getSampleData to infer their purpose
10. Proactively analyze sample data to build comprehensive knowledge about database components
</best_practices>
`.trim();

  let accumulatedText = ""; // To accumulate text deltas if needed

  try {
    // --- Stream the Agent's Response ---
    const { fullStream } = streamText({
      model,
      system: systemPrompt,
      messages: [
        ...conversationHistory,
        {
          role: "user",
          content: userPrompt,
        },
      ],
      tools: agentTools,
      toolChoice: "auto",
      maxSteps: 5,
      abortSignal,
    });

    // --- Process the Stream ---
    for await (const part of fullStream) {
      // Log every part for debugging
      console.log("Stream Part:", part);

      // Yield intermediate steps based on the stream part type
      switch (part.type) {
        case "text-delta":
          accumulatedText += part.textDelta;
          // Yield text delta as a step - can be noisy, might want to aggregate
          yield {
            type: "step",
            data: { text: part.textDelta }, // Yielding delta directly
          };
          break;

        case "tool-call":
          // Yield the request for other tools
          yield {
            type: "step",
            data: { toolCalls: [part] },
          };
          break;

        case "tool-result":
          // Yield the result of a tool execution
          yield {
            type: "step",
            data: { toolResults: [part] },
          };
          break;

        case "step-finish":
          accumulatedText = "";
          break;

        case "finish":
          // Handle the finish event - might contain the final text if no tool was called last
          console.log("Stream Finished. Reason:", part.finishReason);
          console.log("Usage:", part.usage);
          // If there was remaining text, yield it
          if (accumulatedText) {
            yield {
              type: "step",
              data: { text: accumulatedText, finishReason: part.finishReason },
            };
          }
          break;

        case "error":
          // Handle stream-level errors
          console.error("Stream Error:", part.error);
          yield { type: "error", error: `${part.error}` };
          break;

        default:
          // Handle other potential part types if the API evolves
          console.warn("Unhandled stream part type:", (part as any).type);
      }
    }
  } catch (error: any) {
    console.error("Error during generateSqlAgent stream processing:", error);
    const errorMsg = `An unexpected error occurred: ${error.message}`;
    yield { type: "error", error: errorMsg };
  }
}

// --- Example Usage (replace with your actual call) ---
// async function testAgentGenerator() {
//   const db = 'testDB';
//   const table = 'users';
//   const prompt = `show me the 5 newest users`;

//   console.log('\n--- STARTING AGENT GENERATOR ---');
//   try {
//     for await (const event of generateSqlAgent(prompt, db, table)) {
//       console.log(`\n--- Received Event (Type: ${event.type}) ---`);
//       if (event.type === 'step') {
//         console.log('Step Data:', event.data);
//       } else if (event.type === 'final') {
//         console.log('Final Result:', event.data);
//       } else if (event.type === 'error') {
//         console.error('Error Event:', event.error);
//       }
//       console.log('------------------------------------');
//     }
//     console.log('\n--- AGENT GENERATOR FINISHED ---');
//   } catch (e) {
//     console.error("\n--- AGENT GENERATOR FAILED ---", e);
//   }
// }

// testAgentGenerator(); // Uncomment to run a test
