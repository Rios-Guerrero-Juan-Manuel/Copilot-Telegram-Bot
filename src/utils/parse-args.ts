/**
 * Parse command arguments respecting quotes and escape sequences.
 * 
 * This parser implements a state machine that processes input character by character:
 * - NORMAL: Default state, splits on spaces
 * - IN_DOUBLE_QUOTE: Inside double quotes, spaces are preserved
 * - IN_SINGLE_QUOTE: Inside single quotes, spaces are preserved
 * - ESCAPE: Next character is escaped (literal)
 * 
 * @param text - The full command text (e.g., "/addproject name \"path with spaces\"")
 * @returns Array of parsed arguments (excluding the command itself)
 */
export function parseCommandArgs(text: string): string[] {
  const firstSpaceIndex = text.indexOf(' ');
  if (firstSpaceIndex === -1) {
    return [];
  }
  
  const argsText = text.slice(firstSpaceIndex + 1);
  
  enum State {
    NORMAL,
    IN_DOUBLE_QUOTE,
    IN_SINGLE_QUOTE,
    ESCAPE,
  }
  
  const args: string[] = [];
  let currentArg = '';
  let state = State.NORMAL;
  let previousState = State.NORMAL;
  let inQuotedSection = false;
  
  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];
    
    switch (state) {
      case State.NORMAL:
        if (char === '\\' && i + 1 < argsText.length && argsText[i + 1] === ' ') {
          previousState = state;
          state = State.ESCAPE;
        } else if (char === '"' && currentArg.length === 0) {
          inQuotedSection = true;
          state = State.IN_DOUBLE_QUOTE;
        } else if (char === "'" && currentArg.length === 0) {
          inQuotedSection = true;
          state = State.IN_SINGLE_QUOTE;
        } else if (char === ' ') {
          if (currentArg.length > 0 || inQuotedSection) {
            args.push(currentArg);
            currentArg = '';
            inQuotedSection = false;
          }
        } else {
          currentArg += char;
        }
        break;
        
      case State.IN_DOUBLE_QUOTE:
        if (char === '\\' && i + 1 < argsText.length) {
          const nextChar = argsText[i + 1];
          const isTrailingBackslash = nextChar === '"' && i + 2 === argsText.length;
          
          if (isTrailingBackslash) {
            currentArg += char;
            i++;
            state = State.NORMAL;
          } else if (nextChar === '"' || nextChar === '\\') {
            previousState = state;
            state = State.ESCAPE;
          } else {
            currentArg += char;
          }
        } else if (char === '"') {
          state = State.NORMAL;
        } else {
          currentArg += char;
        }
        break;
        
      case State.IN_SINGLE_QUOTE:
        if (char === '\\' && i + 1 < argsText.length) {
          const nextChar = argsText[i + 1];
          if (nextChar === "'" || nextChar === '\\') {
            previousState = state;
            state = State.ESCAPE;
          } else {
            currentArg += char;
          }
        } else if (char === "'") {
          state = State.NORMAL;
        } else {
          currentArg += char;
        }
        break;
        
      case State.ESCAPE:
        currentArg += char;
        state = previousState;
        break;
    }
  }
  
  if (currentArg.length > 0 || state === State.IN_DOUBLE_QUOTE || state === State.IN_SINGLE_QUOTE || inQuotedSection) {
    args.push(currentArg);
  }
  
  return args;
}
