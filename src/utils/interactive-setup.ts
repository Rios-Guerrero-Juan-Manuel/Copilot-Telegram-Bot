import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

interface EnvVariable {
  key: string;
  description: string;
  defaultValue?: string;
  required: boolean;
  section: string;
  validator?: (value: string) => boolean;
  errorMessage?: string;
}

const REQUIRED_VARS: EnvVariable[] = [
  {
    key: 'TELEGRAM_BOT_TOKEN',
    description: 'Bot token from @BotFather',
    required: true,
    section: 'TELEGRAM',
    validator: (val) => val.length > 20 && val.includes(':'),
    errorMessage: 'Token must have a valid format (example: 123456:ABC-DEF1234ghIkl)',
  },
  {
    key: 'TELEGRAM_CHAT_ID',
    description: 'Your numeric Telegram user ID (get from @userinfobot)',
    required: true,
    section: 'TELEGRAM',
    validator: (val) => /^\d+$/.test(val),
    errorMessage: 'Chat ID must be a number',
  },
];

interface ParsedEnvFile {
  [key: string]: string;
}

function parseEnvFile(filePath: string): ParsedEnvFile {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const result: ParsedEnvFile = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        result[key] = value;
      }
    }
  }

  return result;
}

function detectMissingEnvVars(): EnvVariable[] {
  const envPath = path.join(process.cwd(), '.env');
  const currentEnv = parseEnvFile(envPath);
  const missing: EnvVariable[] = [];

  for (const variable of REQUIRED_VARS) {
    const currentValue = currentEnv[variable.key] || process.env[variable.key];
    
    if (variable.required && (!currentValue || currentValue === '')) {
      missing.push(variable);
    } else if (!variable.required && !currentValue) {
      missing.push(variable);
    }
  }

  return missing;
}

function promptForInput(
  question: string,
  defaultValue?: string,
  isSecret: boolean = false
): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = defaultValue 
      ? `${question}\nDefault: ${defaultValue}\n> `
      : `${question}\n> `;

    if (isSecret) {
      const stdin = process.stdin as any;
      const originalMode = stdin.isTTY ? stdin.setRawMode : null;
      
      process.stdout.write(prompt);
      
      let input = '';
      stdin.on('data', function onData(char: Buffer) {
        const c = char.toString('utf-8');
        
        switch (c) {
          case '\n':
          case '\r':
          case '\u0004':
            stdin.removeListener('data', onData);
            if (originalMode) stdin.setRawMode(false);
            process.stdout.write('\n');
            rl.close();
            resolve(input || defaultValue || '');
            break;
          case '\u0003':
            process.exit(0);
            break;
          case '\u007f':
          case '\b':
            if (input.length > 0) {
              input = input.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            if (c.charCodeAt(0) >= 32) {
              input += c;
              process.stdout.write('*');
            }
            break;
        }
      });
      
      if (originalMode) stdin.setRawMode(true);
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim() || defaultValue || '');
      });
    }
  });
}

async function promptForEnvVar(variable: EnvVariable): Promise<string> {
  const isSecret = variable.key.includes('TOKEN') || variable.key.includes('SECRET');
  
  while (true) {
      const value = await promptForInput(
      `📝 ${variable.key}\n   ${variable.description}${variable.required ? ' (required)' : ' (optional)'}`,
      variable.defaultValue,
      isSecret
    );

    if (!variable.required && value === '') {
      return variable.defaultValue || '';
    }

    if (variable.required && value === '') {
      console.log('❌ This variable is required. Please enter a value.\n');
      continue;
    }

    if (variable.validator && !variable.validator(value)) {
      console.log(`❌ ${variable.errorMessage || 'Valor inválido'}. Intenta de nuevo.\n`);
      continue;
    }

    return value;
  }
}

function updateEnvFile(updates: Record<string, string>): void {
  const envPath = path.join(process.cwd(), '.env');
  const envExamplePath = path.join(process.cwd(), '.env.example');

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('📄 Archivo .env creado desde .env.example\n');
    } else {
      fs.writeFileSync(envPath, '');
      console.log('📄 Archivo .env creado\n');
    }
  }

  let content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  const updatedKeys = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      const match = line.match(/^([^=]+)=/);
      if (match) {
        const key = match[1].trim();
        if (key in updates) {
          lines[i] = `${key}=${updates[key]}`;
          updatedKeys.add(key);
        }
      }
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, lines.join('\n'));
}

export async function runInteractiveSetup(): Promise<boolean> {
  if (process.env.SKIP_INTERACTIVE_SETUP === 'true') {
    return false;
  }

  if (!process.stdin.isTTY) {
    console.error('❌ Interactive setup cannot run in a non-interactive environment.');
    console.error('   Configure environment variables manually or use a .env file');
    return false;
  }

  const missing = detectMissingEnvVars();
  
  if (missing.length === 0) {
    return false;
  }

  console.log('\n⚠️  Missing environment variables in .env\n');
  console.log('📋 Missing variables detected:');
  for (const v of missing) {
    const status = v.required ? 'required' : 'optional';
    console.log(`   - ${v.key} (${status})`);
  }
  console.log('\n🔧 Interactive setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const updates: Record<string, string> = {};
  let currentSection = '';

  for (let i = 0; i < missing.length; i++) {
    const variable = missing[i];
    
    if (currentSection !== variable.section) {
      currentSection = variable.section;
      console.log(`\n═══ ${variable.section} ═══\n`);
    }

    console.log(`[${i + 1}/${missing.length}]`);
    const value = await promptForEnvVar(variable);
    updates[variable.key] = value;
    console.log('');
  }

  updateEnvFile(updates);

  console.log('✅ Setup completed');
  console.log('📝 Variables saved to .env\n');

  return true;
}

export function shouldRunInteractiveSetup(): boolean {
  if (process.env.SKIP_INTERACTIVE_SETUP === 'true') {
    return false;
  }

  const missing = detectMissingEnvVars();
  return missing.some(v => v.required);
}
