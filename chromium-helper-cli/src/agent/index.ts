// Main entry point for the agent feature
import { Chatbot } from './chatbot.js';

export async function startAgent() {
  try {
    // console.log("Agent feature starting...");
    const chat = await Chatbot.create(); // Chatbot.create() is now async
    await chat.start();
  } catch (error) {
    console.error("Failed to start the AI Agent:", error);
    // Optionally, exit or provide more user-friendly error message
  }
}
