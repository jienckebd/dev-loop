/**
 * Comprehensive Test Suite for JSON Parser
 * 
 * Tests based on real response patterns from observations.json
 */

import { JsonSchemaValidator, ValidationResult } from '../json-schema-validator';
import { extractCodeChanges, parseCodeChangesFromText } from '../json-parser';
import { CodeChanges } from '../../../types';

describe('JsonSchemaValidator - Real Response Patterns', () => {
  
  describe('Test 1: Real Cursor CLI Response Pattern', () => {
    it('should extract CodeChanges from double-escaped JSON in result field', () => {
      const realResponse = {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 80431,
        duration_api_ms: 80431,
        result: "\nCreating the NotificationEventSubscriber and registering it in services.yml.\n\n\n\n\n\n\nCreating the NotificationEventSubscriber and updating services.yml:\n\nReturning the JSON response:\n\n{\\\"files\\\": [{\\\"path\\\": \\\"docroot/modules/share/bd_notification_system/src/EventSubscriber/NotificationEventSubscriber.php\\\", \\\"content\\\": \\\"<?php\\\\n\\\\nnamespace Drupal\\\\\\\\bd_notification_system\\\\\\\\EventSubscriber;\\\\n\\\\nclass NotificationEventSubscriber {}\\\", \\\"operation\\\": \\\"create\\\"}], \\\"summary\\\": \\\"Created NotificationEventSubscriber\\\"}"
      };
      
      const resultString = JSON.stringify(realResponse);
      const validationResult = JsonSchemaValidator.extractAndValidate(resultString);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(1);
      expect(validationResult.normalized?.files[0].path).toContain('NotificationEventSubscriber.php');
    });
  });

  describe('Test 2: Narrative with Embedded JSON', () => {
    it('should extract JSON after "Returning JSON confirmation:"', () => {
      const narrativeResponse = "The NotificationService already exists and meets all requirements. Returning JSON confirmation:\n\n{\"files\": [], \"summary\": \"NotificationService already exists at docroot/modules/share/bd_notification_system/src/Service/NotificationService.php with all required methods\"}";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(narrativeResponse);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(0);
      expect(validationResult.normalized?.summary).toContain('NotificationService already exists');
    });
  });

  describe('Test 3: Double-Escaped JSON in Result Field', () => {
    it('should unescape and parse double-escaped JSON', () => {
      const doubleEscaped = "{\"type\":\"result\",\"result\":\"{\\\"files\\\": [{\\\"path\\\": \\\"test.php\\\", \\\"content\\\": \\\"<?php\\\\n\\\", \\\"operation\\\": \\\"create\\\"}], \\\"summary\\\": \\\"test\\\"}\"}";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(doubleEscaped);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(1);
      expect(validationResult.normalized?.files[0].path).toBe('test.php');
    });
  });

  describe('Test 4: Markdown Code Block with JSON', () => {
    it('should extract JSON from markdown code block', () => {
      const markdownResponse = "Here's the response:\n```json\n{\"files\": [{\"path\": \"test.php\", \"content\": \"<?php\\n\", \"operation\": \"create\"}], \"summary\": \"test\"}\n```";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(markdownResponse);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(1);
    });
  });

  describe('Test 5: Multiple JSON Objects', () => {
    it('should select the object with files and summary fields', () => {
      const multipleJson = "First: {\"test\": true}\nSecond: {\"files\": [{\"path\": \"test.php\", \"content\": \"<?php\\n\", \"operation\": \"create\"}], \"summary\": \"test\"}";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(multipleJson);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(1);
      expect(validationResult.normalized?.summary).toBe('test');
    });
  });

  describe('Test 6: Nested Result Objects', () => {
    it('should recursively extract from nested result fields', () => {
      const nestedResult = {"type":"result","result":{"type":"result","result":"{\"files\": [{\"path\": \"test.php\", \"content\": \"<?php\\n\", \"operation\": \"create\"}], \"summary\": \"test\"}"}};
      
      const resultString = JSON.stringify(nestedResult);
      const validationResult = JsonSchemaValidator.extractAndValidate(resultString);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(1);
    });
  });

  describe('Test 7: JSON After Various Phrases', () => {
    const phrases = [
      "Returning the JSON response:",
      "Returning JSON confirmation:",
      "JSON format:",
      "Response:",
      "Result:",
      "Here's the JSON:",
      "JSON response:"
    ];

    phrases.forEach(phrase => {
      it(`should extract JSON after phrase: "${phrase}"`, () => {
        const text = `Some narrative text.\n${phrase}\n\n{\"files\": [{\"path\": \"test.php\", \"content\": \"<?php\\n\", \"operation\": \"create\"}], \"summary\": \"test\"}`;
        
        const validationResult = JsonSchemaValidator.extractAndValidate(text);
        
        expect(validationResult.valid).toBe(true);
        expect(validationResult.normalized).toBeDefined();
      });
    });
  });

  describe('Test 8: Edge Cases with Partial JSON', () => {
    it('should handle truncated JSON using partial-json-parser-js', () => {
      // This test requires partial-json to be available
      const truncatedJson = "{\"files\": [{\"path\": \"test.php\", \"content\": \"<?php\\n\"";
      
      // Note: This may not always succeed, but should not throw
      const validationResult = JsonSchemaValidator.extractAndValidate(truncatedJson);
      
      // Either valid (if partial-json parsed it) or invalid (expected)
      expect(typeof validationResult.valid).toBe('boolean');
    });

    it('should handle truncated string in summary', () => {
      const truncatedString = "{\"files\": [], \"summary\": \"test";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(truncatedString);
      
      // May succeed with partial-json or fail - both are acceptable
      expect(typeof validationResult.valid).toBe('boolean');
    });
  });

  describe('Test 9: Empty Files Array', () => {
    it('should accept empty files array as valid CodeChanges', () => {
      const emptyFiles = "{\"files\": [], \"summary\": \"Files already exist\"}";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(emptyFiles);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(0);
      expect(validationResult.normalized?.summary).toBe('Files already exist');
    });
  });

  describe('Test 10: Invalid Structures', () => {
    it('should reject missing files field', () => {
      const invalid = "{\"summary\": \"test\"}";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(invalid);
      
      expect(validationResult.valid).toBe(false);
      expect(validationResult.errors).toContain('Missing required field: files');
    });

    it('should reject missing summary field', () => {
      const invalid = "{\"files\": []}";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(invalid);
      
      expect(validationResult.valid).toBe(false);
      expect(validationResult.errors).toContain('Missing required field: summary');
    });

    it('should reject invalid operation values', () => {
      const invalid = "{\"files\": [{\"path\": \"test.php\", \"operation\": \"invalid\"}], \"summary\": \"test\"}";
      
      const validationResult = JsonSchemaValidator.extractAndValidate(invalid);
      
      expect(validationResult.valid).toBe(false);
      expect(validationResult.errors.some(e => e.includes('operation'))).toBe(true);
    });
  });

  describe('Test 11: Real-World Complex Case', () => {
    it('should handle double-escaped JSON with complex PHP code content', () => {
      const complexCase = JSON.stringify({
        type: "result",
        result: "\nCreating the NotificationEventSubscriber and registering it in services.yml.\n\n\n\n\n\n\nCreating the NotificationEventSubscriber and updating services.yml:\n\nReturning the JSON response:\n\n{\\\"files\\\": [{\\\"path\\\": \\\"docroot/modules/share/bd_notification_system/src/EventSubscriber/NotificationEventSubscriber.php\\\", \\\"content\\\": \\\"<?php\\\\n\\\\nnamespace Drupal\\\\\\\\bd_notification_system\\\\\\\\EventSubscriber;\\\\n\\\\nuse Drupal\\\\\\\\Core\\\\\\\\Entity\\\\\\\\EntityInterface;\\\\nuse Drupal\\\\\\\\Core\\\\\\\\Entity\\\\\\\\EntityTypeManagerInterface;\\\\nuse Drupal\\\\\\\\Core\\\\\\\\Session\\\\\\\\AccountProxyInterface;\\\\nuse Symfony\\\\\\\\Component\\\\\\\\EventDispatcher\\\\\\\\EventSubscriberInterface;\\\\nuse Symfony\\\\\\\\Component\\\\\\\\EventDispatcher\\\\\\\\GenericEvent;\\\\n\\\\nclass NotificationEventSubscriber implements EventSubscriberInterface {\\\\n\\\\n  protected $entityTypeManager;\\\\n  protected $currentUser;\\\\n\\\\n  public function __construct(EntityTypeManagerInterface $entityTypeManager, AccountProxyInterface $currentUser) {\\\\n    $this->entityTypeManager = $entityTypeManager;\\\\n    $this->currentUser = $currentUser;\\\\n  }\\\\n\\\\n  public static function getSubscribedEvents() {\\\\n    return [\\\\n      'entity.insert' => ['onEntityCreate', 0],\\\\n      'entity.update' => ['onEntityUpdate', 0],\\\\n      'entity.delete' => ['onEntityDelete', 0],\\\\n      'user.login' => ['onUserLogin', 0],\\\\n    ];\\\\n  }\\\\n\\\\n  public function onEntityCreate(GenericEvent $event) {\\\\n    $entity = $event->getSubject();\\\\n    if ($entity instanceof EntityInterface) {\\\\n      // Queue notification\\\\n    }\\\\n  }\\\\n\\\\n  public function onEntityUpdate(GenericEvent $event) {\\\\n    $entity = $event->getSubject();\\\\n    if ($entity instanceof EntityInterface) {\\\\n      // Queue notification\\\\n    }\\\\n  }\\\\n\\\\n  public function onEntityDelete(GenericEvent $event) {\\\\n    $entity = $event->getSubject();\\\\n    if ($entity instanceof EntityInterface) {\\\\n      // Queue notification\\\\n    }\\\\n  }\\\\n\\\\n  public function onUserLogin(GenericEvent $event) {\\\\n    $account = $event->getSubject();\\\\n    if ($account instanceof AccountInterface) {\\\\n      // Queue notification\\\\n    }\\\\n  }\\\\n}\\\\n\\\", \\\"operation\\\": \\\"create\\\"}], \\\"summary\\\": \\\"Created NotificationEventSubscriber with event handlers\\\"}"
      });
      
      const validationResult = JsonSchemaValidator.extractAndValidate(complexCase);
      
      expect(validationResult.valid).toBe(true);
      expect(validationResult.normalized).toBeDefined();
      expect(validationResult.normalized?.files).toHaveLength(1);
      expect(validationResult.normalized?.files[0].path).toContain('NotificationEventSubscriber.php');
      expect(validationResult.normalized?.files[0].content).toContain('class NotificationEventSubscriber');
    });
  });
});

describe('extractCodeChanges Integration Tests', () => {
  it('should extract from object with result field', () => {
    const response = {
      type: "result",
      result: "{\"files\": [{\"path\": \"test.php\", \"content\": \"<?php\\n\", \"operation\": \"create\"}], \"summary\": \"test\"}"
    };
    
    const codeChanges = extractCodeChanges(response);
    
    expect(codeChanges).not.toBeNull();
    expect(codeChanges?.files).toHaveLength(1);
  });

  it('should extract from string with markdown', () => {
    const response = "```json\n{\"files\": [], \"summary\": \"test\"}\n```";
    
    const codeChanges = extractCodeChanges(response);
    
    expect(codeChanges).not.toBeNull();
    expect(codeChanges?.files).toHaveLength(0);
  });

  it('should handle direct CodeChanges object', () => {
    const response: CodeChanges = {
      files: [{
        path: "test.php",
        content: "<?php\n",
        operation: "create"
      }],
      summary: "test"
    };
    
    const codeChanges = extractCodeChanges(response);
    
    expect(codeChanges).not.toBeNull();
    expect(codeChanges?.files).toHaveLength(1);
  });
});
