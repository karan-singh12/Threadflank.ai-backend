import { AgentTool } from './tool.types';

const EVENT_TYPES = ['Wedding', 'Work / Meeting', 'Party / Night Out', 'Date Night', 'Casual Outing', 'Formal / Gala', 'Travel'];
const DRESS_CODES = ['Casual', 'Smart Casual', 'Business', 'Formal', 'Black Tie'];

/** Static reference-data tool (PRD §4.4 event/dress-code vocabulary) so the agent
 * can ground its output in Threadflank's actual taxonomy instead of inventing one. */
export function buildOccasionTools(): AgentTool[] {
  return [
    {
      definition: {
        name: 'list_occasion_taxonomy',
        description: 'List the supported event types and dress codes for the Occasion Planner.',
        parameters: { type: 'object', properties: {} },
      },
      execute: async () => ({ eventTypes: EVENT_TYPES, dressCodes: DRESS_CODES }),
    },
  ];
}
