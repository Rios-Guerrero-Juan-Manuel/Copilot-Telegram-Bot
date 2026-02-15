/**
 * Utility functions for plan mode operations
 */

import { DatabaseManager } from '../state/database';
import { logger } from './logger';

/**
 * Extracts plan content from AI response using markers
 * 
 * @param text - The AI response text
 * @returns Object with title and content, or null if no plan found
 */
export function extractPlanFromResponse(text: string): { title: string; content: string } | null {
  const planMatch = text.match(/---BEGIN PLAN---([\s\S]+?)---END PLAN---/);
  
  if (!planMatch) {
    return null;
  }
  
  const planContent = planMatch[1].trim();
  
  // Extract title from first heading
  const titleMatch = planContent.match(/^#\s+(?:Plan:?\s*)?(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled Plan';
  
  return {
    title,
    content: planContent,
  };
}

/**
 * Saves a plan to the database (graceful degradation if fails)
 * 
 * @param db - Database manager instance
 * @param userId - User ID
 * @param projectPath - Project path
 * @param planText - Plan text (will extract title and content)
 * @returns Plan ID if successful, null if failed
 */
export function savePlanToDatabase(
  db: DatabaseManager,
  userId: number,
  projectPath: string,
  planText: string
): number | null {
  try {
    const extracted = extractPlanFromResponse(planText);
    
    if (!extracted) {
      logger.warn('Could not extract plan from response (no markers found), saving full text', {
        userId,
        projectPath,
        textLength: planText.length,
      });
      
      // Fallback: save entire text as plan
      const planId = db.savePlan(userId, projectPath, 'Plan', planText);
      logger.info('Plan saved to database (fallback mode)', {
        userId,
        projectPath,
        planId,
      });
      return planId;
    }
    
    const planId = db.savePlan(userId, projectPath, extracted.title, extracted.content);
    logger.info('Plan saved to database', {
      userId,
      projectPath,
      planId,
      title: extracted.title,
    });
    return planId;
  } catch (error: any) {
    logger.error('Failed to save plan to database (graceful degradation)', {
      userId,
      projectPath,
      error: error.message,
    });
    return null;
  }
}
