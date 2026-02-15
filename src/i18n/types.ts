/**
 * Supported locale keys for internationalization.
 */
export type LocaleKey = 'en' | 'es';

/**
 * Configuration for the internationalization system.
 */
export interface I18nConfig {
  /**
   * Default locale to use when user locale is not set.
   */
  defaultLocale: LocaleKey;
  
  /**
   * List of supported locales in the application.
   */
  supportedLocales: LocaleKey[];
}

/**
 * Complete translation structure containing all translatable strings.
 */
export interface Translations {
  common: {
    yes: string;
    no: string;
    cancel: string;
    confirm: string;
    back: string;
    next: string;
    previous: string;
    error: string;
    success: string;
    warning: string;
    loading: string;
  };

  commands: {
    start: {
      welcome: string;
      status: string;
      help: string;
    };
    help: {
      title: string;
      description: string;
      categories: {
        info: string;
        navigation: string;
        copilot: string;
        mcp: string;
      };
    };
    status: {
      title: string;
      model: string;
      project: string;
      sessions: string;
      mcpServers: string;
      noActiveSessions: string;
    };
    language: {
      current: string;
      select: string;
      changed: string;
    };
  };

  errors: {
    generic: string;
    notAuthorized: string;
    operationInProgress: string;
    invalidInput: string;
    pathNotAllowed: string;
    sessionNotFound: string;
    timeout: string;
    networkError: string;
  };

  wizards: {
    cd: {
      title: string;
      selectDirectory: string;
      currentPath: string;
      confirm: string;
      cancelled: string;
      success: string;
      timeout: string;
    };
    addProject: {
      title: string;
      enterName: string;
      selectPath: string;
      summary: string;
      saved: string;
      cancelled: string;
      alreadyExists: string;
    };
    mcp: {
      title: string;
      enterName: string;
      selectType: string;
      enterCommand: string;
      enterArgs: string;
      enterUrl: string;
      enterEnv: string;
      summary: string;
      created: string;
      cancelled: string;
      invalidName: string;
      invalidUrl: string;
    };
  };

  mcp: {
    list: {
      title: string;
      empty: string;
      page: string;
    };
    delete: {
      success: string;
      notFound: string;
    };
    types: {
      stdio: string;
      http: string;
    };
  };

  projects: {
    list: {
      title: string;
      empty: string;
    };
    add: {
      success: string;
      alreadyExists: string;
    };
    remove: {
      success: string;
      notFound: string;
    };
    switch: {
      success: string;
      notFound: string;
    };
  };

  navigation: {
    pwd: string;
    ls: {
      title: string;
      empty: string;
    };
    cd: {
      success: string;
      invalidPath: string;
    };
  };

  session: {
    stop: {
      success: string;
      noOperation: string;
    };
    reset: {
      success: string;
      noSession: string;
    };
    extend: {
      success: string;
      noOperation: string;
      maxReached: string;
    };
  };

  plan: {
    enter: string;
    exit: string;
    active: string;
  };

  copilot: {
    thinking: string;
    generating: string;
    streaming: string;
    complete: string;
    stopped: string;
  };
}
