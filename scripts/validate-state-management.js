#!/usr/bin/env node

/**
 * State Management Validation Script
 * 
 * Scans codebase for direct file I/O operations and validates UnifiedStateManager usage.
 * Identifies migration gaps and validates file paths.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');

// File patterns to check
const patterns = {
  directFileIO: [
    /fs\.readJson|fs\.writeJson|fs\.readFileSync|fs\.writeFileSync|fs\.readFile|fs\.writeFile/g,
  ],
  devloopPaths: [
    /\.devloop\/[^/]+\.json/g,
    /['"]\.devloop\//g,
  ],
  oldFileReferences: [
    /state\.json|prd-set-state\.json|retry-counts\.json|cursor-sessions\.json|contribution-mode\.json|evolution-state\.json/gi,
    /prd-set-metrics\.json|prd-metrics\.json|phase-metrics\.json|feature-metrics\.json|schema-metrics\.json/gi,
  ],
  unifiedStateManager: [
    /UnifiedStateManager|from.*StateManager|import.*StateManager/g,
  ],
};

// Files to exclude from scanning
const excludePatterns = [
  /node_modules/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /dist\//,
  /scripts\/validate-state-management\.js$/,
];

// State files that should use UnifiedStateManager
const stateFiles = [
  'execution-state.json',
  'metrics.json',
  'patterns.json',
  'observations.json',
];

// Old state files that should NOT exist
const oldStateFiles = [
  'state.json',
  'prd-set-state.json',
  'retry-counts.json',
  'cursor-sessions.json',
  'contribution-mode.json',
  'evolution-state.json',
  'prd-set-metrics.json',
  'prd-metrics.json',
  'phase-metrics.json',
  'feature-metrics.json',
  'schema-metrics.json',
  'parallel-metrics.json',
  'observation-metrics.json',
  'pattern-metrics.json',
];

function shouldExclude(filePath) {
  return excludePatterns.some(pattern => pattern.test(filePath));
}

function findFiles(dir, extensions = ['.ts', '.js']) {
  const files = [];
  
  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (shouldExclude(fullPath)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  
  walk(dir);
  return files;
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(projectRoot, filePath);
  const results = {
    file: relativePath,
    directFileIO: [],
    devloopPaths: [],
    oldFileReferences: [],
    usesUnifiedStateManager: false,
  };
  
  // Check for direct file I/O
  for (const pattern of patterns.directFileIO) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const line = content.substring(0, match.index).split('\n').length;
      results.directFileIO.push({
        pattern: match[0],
        line,
      });
    }
  }
  
  // Check for .devloop paths
  for (const pattern of patterns.devloopPaths) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const line = content.substring(0, match.index).split('\n').length;
      results.devloopPaths.push({
        match: match[0],
        line,
      });
    }
  }
  
  // Check for old file references
  for (const pattern of patterns.oldFileReferences) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const line = content.substring(0, match.index).split('\n').length;
      results.oldFileReferences.push({
        match: match[0],
        line,
      });
    }
  }
  
  // Check for UnifiedStateManager usage
  for (const pattern of patterns.unifiedStateManager) {
    if (pattern.test(content)) {
      results.usesUnifiedStateManager = true;
      break;
    }
  }
  
  return results;
}

function main() {
  console.log('🔍 Scanning codebase for state management patterns...\n');
  
  const files = findFiles(srcDir);
  console.log(`Found ${files.length} files to analyze\n`);
  
  const results = {
    filesWithDirectFileIO: [],
    filesWithOldReferences: [],
    filesUsingUnifiedStateManager: [],
    migrationGaps: [],
  };
  
  // Analyze each file
  for (const file of files) {
    const analysis = analyzeFile(file);
    
    if (analysis.directFileIO.length > 0) {
      results.filesWithDirectFileIO.push(analysis);
    }
    
    if (analysis.oldFileReferences.length > 0) {
      results.filesWithOldReferences.push(analysis);
    }
    
    if (analysis.usesUnifiedStateManager) {
      results.filesUsingUnifiedStateManager.push(analysis.file);
    }
    
    // Check for migration gaps: files with direct file I/O that should use UnifiedStateManager
    if (analysis.directFileIO.length > 0 && !analysis.usesUnifiedStateManager) {
      // Check if file path references state files
      const hasStateFileReference = analysis.devloopPaths.some(p => 
        stateFiles.some(sf => p.match.includes(sf))
      );
      
      if (hasStateFileReference) {
        results.migrationGaps.push({
          file: analysis.file,
          directFileIO: analysis.directFileIO,
          devloopPaths: analysis.devloopPaths,
        });
      }
    }
  }
  
  // Print results
  console.log('='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  
  console.log(`\n📊 Files using UnifiedStateManager: ${results.filesUsingUnifiedStateManager.length}`);
  if (results.filesUsingUnifiedStateManager.length > 0) {
    console.log('\nFiles:');
    results.filesUsingUnifiedStateManager.forEach(file => {
      console.log(`  ✓ ${file}`);
    });
  }
  
  console.log(`\n⚠️  Files with direct file I/O: ${results.filesWithDirectFileIO.length}`);
  if (results.filesWithDirectFileIO.length > 0) {
    console.log('\nFiles (first 20):');
    results.filesWithDirectFileIO.slice(0, 20).forEach(result => {
      console.log(`  ${result.file}`);
      result.directFileIO.slice(0, 3).forEach(io => {
        console.log(`    Line ${io.line}: ${io.pattern}`);
      });
    });
    if (results.filesWithDirectFileIO.length > 20) {
      console.log(`  ... and ${results.filesWithDirectFileIO.length - 20} more`);
    }
  }
  
  console.log(`\n🚫 Files with old file references: ${results.filesWithOldReferences.length}`);
  if (results.filesWithOldReferences.length > 0) {
    console.log('\nFiles:');
    results.filesWithOldReferences.forEach(result => {
      console.log(`  ${result.file}`);
      result.oldFileReferences.slice(0, 3).forEach(ref => {
        console.log(`    Line ${ref.line}: ${ref.match}`);
      });
    });
  }
  
  console.log(`\n🔧 Migration gaps (direct file I/O for state files without UnifiedStateManager): ${results.migrationGaps.length}`);
  if (results.migrationGaps.length > 0) {
    console.log('\nFiles that should use UnifiedStateManager:');
    results.migrationGaps.forEach(gap => {
      console.log(`  ${gap.file}`);
      console.log(`    Direct file I/O: ${gap.directFileIO.length} instances`);
      console.log(`    .devloop paths: ${gap.devloopPaths.length} instances`);
    });
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total files analyzed: ${files.length}`);
  console.log(`Files using UnifiedStateManager: ${results.filesUsingUnifiedStateManager.length}`);
  console.log(`Files with direct file I/O: ${results.filesWithDirectFileIO.length}`);
  console.log(`Files with old file references: ${results.filesWithOldReferences.length}`);
  console.log(`Migration gaps identified: ${results.migrationGaps.length}`);
  
  // Exit code based on findings
  if (results.filesWithOldReferences.length > 0 || results.migrationGaps.length > 0) {
    console.log('\n❌ Issues found - see details above');
    process.exit(1);
  } else {
    console.log('\n✅ No issues found');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = { analyzeFile, findFiles };
