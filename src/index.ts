import {Diagnostic, DiagnosticCategory} from "typescript";
import {server, LanguageService, SourceFile} from "typescript/lib/tsserverlibrary"
import {minimatch} from 'minimatch'

function init() {
  function create({config, languageService, project}: server.PluginCreateInfo) {
    const {name: pluginName, imports}: PluginConfig = config;
    
    const proxy: LanguageService = Object.create(null);
    for (let k of Object.keys(languageService) as Array<keyof LanguageService>) {
      const x = languageService[k]!;
      // @ts-expect-error - JS runtime trickery which is tricky to type tersely
      proxy[k] = (...args: Array<{}>) => x.apply(languageService, args);
    }
    
    proxy.getSemanticDiagnostics = (filename) => {
      const existingDiagnostics = languageService
        .getSemanticDiagnostics(filename)
        .filter(({source}) => source !== pluginName);
      
      const doc: SourceFileWithImports | undefined = languageService.getProgram()?.getSourceFile(filename);
      
      if (!doc) return existingDiagnostics;
      
      const diagnostics = (doc.imports ?? [])
        .map(({text: importText, pos: importTextStartPosition, end: importTextEndPosition}) => {
          if (importTextStartPosition < 0) return;
          
          const allowedImportsForCurrentDoc = Object
            .entries(imports ?? {})
            .filter(([source]) => minimatch(doc.fileName, source))
            .map(([, allowedImports]) => allowedImports)
            .flat();

          const importAllowed = allowedImportsForCurrentDoc.length > 0
            ? allowedImportsForCurrentDoc.some(allowedImport => minimatch(importText, allowedImport))
            : false;
          
          if (importAllowed) return;
          
          const getDiagnosticError = (): DiagnosticError => {
            if (allowedImportsForCurrentDoc.length > 0) {
              const allowedImportsFormattedText = allowedImportsForCurrentDoc
                .join(", \n");
              
              return {
                message: `Import not allowed. Only imports below allowed from this file: \n${allowedImportsFormattedText}\n`,
                code: 2
              }
            }
            
            return {
              message: `No imports specified for current file. Use \`imports\` option in plugin config in your tsconfig.json`,
              code: 1
            }
          }
          
          const {message, code} = getDiagnosticError();
          
          const diagnostic: Diagnostic = {
            file: doc,
            start: importTextStartPosition,
            length: importTextEndPosition - importTextStartPosition,
            messageText: message,
            category: DiagnosticCategory.Error,
            source: pluginName,
            code
          }
          
          return diagnostic;
        })
        .filter((item: Diagnostic | undefined): item is Diagnostic => Boolean(item))
      
      return [
        ...existingDiagnostics,
        ...diagnostics,
      ];
    };
    
    return proxy;
  }
  
  return {create};
}

export = init;

interface SourceFileWithImports extends SourceFile {
  imports?: Array<{
    text: string;
    pos: number;
    end: number;
  }>;
}

interface PluginConfig {
  name: "ts-allow-imports-plugin",
  imports?: Record<string, Array<string>>;
}

interface DiagnosticError {
  message: string;
  code: number;
}
  
