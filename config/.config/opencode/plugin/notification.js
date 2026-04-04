export const NotificationPlugin = async ({ $, client }) => {
  // Send macOS notification via osascript
  const notify = (title, message) =>
    $`osascript -e ${`display notification "${message}" with title "${title}"`}`;

  // Check if a session is a main (non-subagent) session
  const isMainSession = async (sessionID) => {
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const session = result.data ?? result;
      return !session.parentID;
    } catch {
      // If we can't fetch the session, assume it's main to avoid missing notifications
      return true;
    }
  };

  return {
    event: async ({ event }) => {
      // Only notify for main session events, not background subagents
      if (event.type === "session.idle") {
        const sessionID = event.properties.sessionID;
        if (await isMainSession(sessionID)) {
          await notify("OpenCode", "Agent is idle and waiting for your input");
        }
      }

      // Permission prompt created
      if (event.type === "permission.asked") {
        await notify("OpenCode", "Permission required - check the chat");
      }
    },
  };
};