// Copyright 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

(function(global) {
  'use strict';

  function assert(v) {
    if (!v)
      throw new Error('Assertion failed');
  }

  var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

  function getTreeScope(node) {
    while (node.parentNode) {
      node = node.parentNode;
    }

    return typeof node.getElementById === 'function' ? node : null;
  }

  var Map;
  if (global.Map && typeof global.Map.prototype.forEach === 'function') {
    Map = global.Map;
  } else {
    Map = function() {
      this.keys = [];
      this.values = [];
    };

    Map.prototype = {
      set: function(key, value) {
        var index = this.keys.indexOf(key);
        if (index < 0) {
          this.keys.push(key);
          this.values.push(value);
        } else {
          this.values[index] = value;
        }
      },

      get: function(key) {
        var index = this.keys.indexOf(key);
        if (index < 0)
          return;

        return this.values[index];
      },

      delete: function(key, value) {
        var index = this.keys.indexOf(key);
        if (index < 0)
          return false;

        this.keys.splice(index, 1);
        this.values.splice(index, 1);
        return true;
      },

      forEach: function(f, opt_this) {
        for (var i = 0; i < this.keys.length; i++)
          f.call(opt_this || this, this.values[i], this.keys[i], this);
      }
    };
  }

  // JScript does not have __proto__. We wrap all object literals with
  // createObject which uses Object.create, Object.defineProperty and
  // Object.getOwnPropertyDescriptor to create a new object that does the exact
  // same thing. The main downside to this solution is that we have to extract
  // all those property descriptors for IE.
  var createObject = ('__proto__' in {}) ?
      function(obj) { return obj; } :
      function(obj) {
        var proto = obj.__proto__;
        if (!proto)
          return obj;
        var newObject = Object.create(proto);
        Object.getOwnPropertyNames(obj).forEach(function(name) {
          Object.defineProperty(newObject, name,
                               Object.getOwnPropertyDescriptor(obj, name));
        });
        return newObject;
      };

  // IE does not support have Document.prototype.contains.
  if (typeof document.contains != 'function') {
    Document.prototype.contains = function(node) {
      if (node === this || node.parentNode === this)
        return true;
      return this.documentElement.contains(node);
    }
  }

  var SideTable;
  "undefined" != typeof WeakMap && navigator.userAgent.indexOf("Firefox/") < 0 ? SideTable = WeakMap : function() {
      var a = Object.defineProperty, b = Object.hasOwnProperty, c = new Date().getTime() % 1e9;
      SideTable = function() {
          this.name = "__st" + (1e9 * Math.random() >>> 0) + (c++ + "__");
      }, SideTable.prototype = {
          set: function(b, c) {
              a(b, this.name, {
                  value: c,
                  writable: !0
              });
          },
          get: function(a) {
              return b.call(a, this.name) ? a[this.name] : void 0;
          },
          "delete": function(a) {
              this.set(a, void 0);
          }
      };
  }();

  var BIND = 'bind';
  var REPEAT = 'repeat';
  var IF = 'if';
  var GET_BINDING = 'getBinding';
  var GET_INSTANCE_MODEL = 'getInstanceModel';

  var templateAttributeDirectives = {
    'template': true,
    'repeat': true,
    'bind': true,
    'ref': true
  };

  var semanticTemplateElements = {
    'THEAD': true,
    'TBODY': true,
    'TFOOT': true,
    'TH': true,
    'TR': true,
    'TD': true,
    'COLGROUP': true,
    'COL': true,
    'CAPTION': true,
    'OPTION': true,
    'OPTGROUP': true
  };

  var hasTemplateElement = typeof HTMLTemplateElement !== 'undefined';

  var allTemplatesSelectors = 'template, ' +
      Object.keys(semanticTemplateElements).map(function(tagName) {
        return tagName.toLowerCase() + '[template]';
      }).join(', ');

  function isAttributeTemplate(el) {
    return semanticTemplateElements[el.tagName] &&
        el.hasAttribute('template');
  }

  function isTemplate(el) {
    return el.tagName == 'TEMPLATE' || isAttributeTemplate(el);
  }

  function isNativeTemplate(el) {
    return hasTemplateElement && el.tagName == 'TEMPLATE';
  }

  var ensureScheduled = function() {
    // We need to ping-pong between two Runners in order for the tests to
    // simulate proper end-of-microtask behavior for Object.observe. Without
    // this, we'll continue delivering to a single observer without allowing
    // other observers in the same microtask to make progress.

    function Runner(nextRunner) {
      this.nextRunner = nextRunner;
      this.value = false;
      this.lastValue = this.value;
      this.scheduled = [];
      this.scheduledIds = [];
      this.running = false;
      this.observer = new PathObserver(this, 'value', this.run, this);
    }

    Runner.prototype = {
      schedule: function(async, id) {
        if (this.scheduledIds[id])
          return;

        if (this.running)
          return this.nextRunner.schedule(async, id);

        this.scheduledIds[id] = true;
        this.scheduled.push(async);

        if (this.lastValue !== this.value)
          return;

        this.value = !this.value;
      },

      run: function() {
        this.running = true;

        for (var i = 0; i < this.scheduled.length; i++) {
          var async = this.scheduled[i];
          var id = async[idExpando];
          this.scheduledIds[id] = false;

          if (typeof async === 'function')
            async();
          else
            async.resolve();
        }

        this.scheduled = [];
        this.scheduledIds = [];
        this.lastValue = this.value;

        this.running = false;
      }
    }

    var runner = new Runner(new Runner());

    var nextId = 1;
    var idExpando = '__scheduledId__';

    function ensureScheduled(async) {
      var id = async[idExpando];
      if (!async[idExpando]) {
        id = nextId++;
        async[idExpando] = id;
      }

      runner.schedule(async, id);
    }

    return ensureScheduled;
  }();

  // FIXME: Observe templates being added/removed from documents
  // FIXME: Expose imperative API to decorate and observe templates in
  // "disconnected tress" (e.g. ShadowRoot)
  document.addEventListener('DOMContentLoaded', function(e) {
    bootstrapTemplatesRecursivelyFrom(document);
    // FIXME: Is this needed? Seems like it shouldn't be.
    Platform.performMicrotaskCheckpoint();
  }, false);

  function forAllTemplatesFrom(node, fn) {
    var subTemplates = node.querySelectorAll(allTemplatesSelectors);

    if (isTemplate(node))
      fn(node)
    forEach(subTemplates, fn);
  }

  function bootstrapTemplatesRecursivelyFrom(node) {
    function bootstrap(template) {
      if (!HTMLTemplateElement.decorate(template))
        bootstrapTemplatesRecursivelyFrom(template.content);
    }

    forAllTemplatesFrom(node, bootstrap);
  }

  if (!hasTemplateElement) {
    /**
     * This represents a <template> element.
     * @constructor
     * @extends {HTMLElement}
     */
    global.HTMLTemplateElement = function() {
      throw TypeError('Illegal constructor');
    };
  }

  var hasProto = '__proto__' in {};

  function mixin(to, from) {
    Object.getOwnPropertyNames(from).forEach(function(name) {
      Object.defineProperty(to, name,
                            Object.getOwnPropertyDescriptor(from, name));
    });
  }

  var templateContentsTable = new SideTable();
  var templateContentsOwnerTable = new SideTable();
  var templateInstanceRefTable = new SideTable();
  var contentBindingMapTable = new SideTable();

  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/templates/index.html#dfn-template-contents-owner
  function getTemplateContentsOwner(doc) {
    if (!doc.defaultView)
      return doc;
    var d = templateContentsOwnerTable.get(doc);
    if (!d) {
      // TODO(arv): This should either be a Document or HTMLDocument depending
      // on doc.
      d = doc.implementation.createHTMLDocument('');
      while (d.lastChild) {
        d.removeChild(d.lastChild);
      }
      templateContentsOwnerTable.set(doc, d);
    }
    return d;
  }

  // For non-template browsers, the parser will disallow <template> in certain
  // locations, so we allow "attribute templates" which combine the template
  // element with the top-level container node of the content, e.g.
  //
  //   <tr template repeat="{{ foo }}"" class="bar"><td>Bar</td></tr>
  //
  // becomes
  //
  //   <template repeat="{{ foo }}">
  //   + #document-fragment
  //     + <tr class="bar">
  //       + <td>Bar</td>
  //
  function extractTemplateFromAttributeTemplate(el) {
    var template = el.ownerDocument.createElement('template');
    el.parentNode.insertBefore(template, el);

    var attribs = el.attributes;
    var count = attribs.length;
    while (count-- > 0) {
      var attrib = attribs[count];
      if (templateAttributeDirectives[attrib.name]) {
        if (attrib.name !== 'template')
          template.setAttribute(attrib.name, attrib.value);
        el.removeAttribute(attrib.name);
      }
    }

    return template;
  }

  function liftNonNativeTemplateChildrenIntoContent(template, el, useRoot) {
    var content = template.content;
    if (useRoot) {
      content.appendChild(el);
      return;
    }

    var child;
    while (child = el.firstChild) {
      content.appendChild(child);
    }
  }

  /**
   * Ensures proper API and content model for template elements.
   * @param {HTMLTemplateElement} opt_instanceRef The template element which
   *     |el| template element will return as the value of its ref(), and whose
   *     content will be used as source when createInstance() is invoked.
   */
  HTMLTemplateElement.decorate = function(el, opt_instanceRef) {
    if (el.templateIsDecorated_)
      return false;

    var templateElement = el;
    templateElement.templateIsDecorated_ = true;

    var isNative = isNativeTemplate(templateElement);
    var bootstrapContents = isNative;
    var liftContents = !isNative;
    var liftRoot = false;

    if (!isNative && isAttributeTemplate(templateElement)) {
      assert(!opt_instanceRef);
      templateElement = extractTemplateFromAttributeTemplate(el);
      templateElement.templateIsDecorated_ = true;

      isNative = isNativeTemplate(templateElement);
      liftRoot = true;
    }

    if (!isNative) {
      fixTemplateElementPrototype(templateElement);
      var doc = getTemplateContentsOwner(templateElement.ownerDocument);
      templateContentsTable.set(templateElement, doc.createDocumentFragment());
    }

    if (opt_instanceRef) {
      // template is contained within an instance, its direct content must be
      // empty
      templateInstanceRefTable.set(templateElement, opt_instanceRef);
    } else if (liftContents) {
      liftNonNativeTemplateChildrenIntoContent(templateElement,
                                               el,
                                               liftRoot);
    } else if (bootstrapContents) {
      bootstrapTemplatesRecursivelyFrom(templateElement.content);
    }

    return true;
  };

  // TODO(rafaelw): This used to decorate recursively all templates from a given
  // node. This happens by default on 'DOMContentLoaded', but may be needed
  // in subtrees not descendent from document (e.g. ShadowRoot).
  // Review whether this is the right public API.
  HTMLTemplateElement.bootstrap = bootstrapTemplatesRecursivelyFrom;

  var htmlElement = global.HTMLUnknownElement || HTMLElement;

  var contentDescriptor = {
    get: function() {
      return templateContentsTable.get(this);
    },
    enumerable: true,
    configurable: true
  };

  if (!hasTemplateElement) {
    // Gecko is more picky with the prototype than WebKit. Make sure to use the
    // same prototype as created in the constructor.
    HTMLTemplateElement.prototype = Object.create(htmlElement.prototype);

    Object.defineProperty(HTMLTemplateElement.prototype, 'content',
                          contentDescriptor);
  }

  function fixTemplateElementPrototype(el) {
    // Note: because we need to treat some semantic elements as template
    // elements (like tr or td), but don't want to reassign their proto (gecko
    // doesn't like that), we mixin the properties for those elements.
    if (el.tagName === 'TEMPLATE') {
      if (!hasTemplateElement) {
        if (hasProto)
          el.__proto__ = HTMLTemplateElement.prototype;
        else
          mixin(el, HTMLTemplateElement.prototype);
      }
    } else {
      mixin(el, HTMLTemplateElement.prototype);
      // FIXME: Won't need this when webkit methods move to the prototype.
      Object.defineProperty(el, 'content', contentDescriptor);
    }
  }

  var templateModelTable = new SideTable();
  var templateBindingDelegateTable = new SideTable();
  var templateSetModelFnTable = new SideTable();

  function ensureSetModelScheduled(template) {
    var setModelFn = templateSetModelFnTable.get(template);
    if (!setModelFn) {
      setModelFn = function() {
        addBindings(template, template.model, template.bindingDelegate);
      };

      templateSetModelFnTable.set(template, setModelFn);
    }

    ensureScheduled(setModelFn);
  }

  function TemplateBinding(node, property, model, path, iterator) {
    this.closed = false;
    this.node = node;
    this.property = property;
    this.model = model;
    this.path = path || '';
    this.iterator = iterator;
    this.iterator.inputs.bind(this.property, this.model, this.path);
  }

  TemplateBinding.prototype = createObject({
    close: function() {
      if (this.closed)
        return;
      this.iterator.inputs.unbind(this.property);
      this.iterator = undefined;
      this.node = undefined;
      this.model = undefined;
      this.closed = true;
    }
  });

  mixin(HTMLTemplateElement.prototype, {
    bind: function(name, model, path) {
      if (name !== BIND && name !== REPEAT && name !== IF)
        return HTMLElement.prototype.bind.call(this, name, model, path);

      var iterator = TemplateIterator.getOrCreate(this);
      this.unbind(name);

      return this.bindings[name] =
          new TemplateBinding(this, name, model, path, iterator);
    },

    createInstance: function(model, delegate, bound) {
      var content = this.ref.content;
      var map = contentBindingMapTable.get(content);
      if (!map) {
        // TODO(rafaelw): Setup a MutationObserver on content to detect
        // when the instanceMap is invalid.
        map = createInstanceBindingMap(content) || [];
        contentBindingMapTable.set(content, map);
      }

      var instance = map.hasSubTemplate ?
          deepCloneIgnoreTemplateContent(content) : content.cloneNode(true);

      addMapBindings(instance, map, model, delegate, bound);
      // TODO(rafaelw): We can do this more lazily, but setting a sentinel
      // in the parent of the template element, and creating it when it's
      // asked for by walking back to find the iterating template.
      addTemplateInstanceRecord(instance, model);
      return instance;
    },

    get model() {
      return templateModelTable.get(this);
    },

    set model(model) {
      templateModelTable.set(this, model);
      ensureSetModelScheduled(this);
    },

    get bindingDelegate() {
      return templateBindingDelegateTable.get(this);
    },

    set bindingDelegate(bindingDelegate) {
      templateBindingDelegateTable.set(this, bindingDelegate);
      ensureSetModelScheduled(this);
    },

    get ref() {
      var ref;
      var refId = this.getAttribute('ref');
      if (refId) {
        var treeScope = getTreeScope(this);
        if (treeScope)
          ref = treeScope.getElementById(refId);
      }

      if (!ref)
        ref = templateInstanceRefTable.get(this);

      if (!ref)
        return this;

      var nextRef = ref.ref;
      return nextRef ? nextRef : ref;
    }
  });

  function isSimpleBinding(tokens) {
    // tokens ==? ['', path, '']
    return tokens.length == 3 && tokens[0].length == 0 && tokens[2].length == 0;
  }

  // Returns
  //   a) undefined if there are no mustaches.
  //   b) [TEXT, (PATH, TEXT)+] if there is at least one mustache.
  function parseMustacheTokens(s) {
    if (!s || !s.length)
      return;

    var tokens;
    var length = s.length;
    var startIndex = 0, lastIndex = 0, endIndex = 0;
    while (lastIndex < length) {
      startIndex = s.indexOf('{{', lastIndex);
      endIndex = startIndex < 0 ? -1 : s.indexOf('}}', startIndex + 2);

      if (endIndex < 0) {
        if (!tokens)
          return;

        tokens.push(s.slice(lastIndex)); // TEXT
        break;
      }

      tokens = tokens || [];
      tokens.push(s.slice(lastIndex, startIndex)); // TEXT
      tokens.push(s.slice(startIndex + 2, endIndex).trim()); // PATH
      lastIndex = endIndex + 2;
    }

    if (lastIndex === length)
      tokens.push(''); // TEXT

    return tokens;
  }

  function bindOrDelegate(node, name, model, path, delegate) {
    var delegateBinding;
    var delegateFunction = delegate && delegate[GET_BINDING];
    if (delegateFunction && typeof delegateFunction == 'function') {
      delegateBinding = delegateFunction(model, path, name, node);
      if (delegateBinding) {
        model = delegateBinding;
        path = 'value';
      }
    }

    return node.bind(name, model, path);
  }

  function processBindings(bindings, node, model, delegate, bound) {
    for (var i = 0; i < bindings.length; i += 2) {
      var binding = setupBinding(node, bindings[i], bindings[i + 1], model,
                                 delegate);
      if (bound)
        bound.push(binding);
    }
  }

  function newTokenCombinator(tokens) {
    return function(values) {
      var newValue = tokens[0];

      for (var i = 1; i < tokens.length; i += 2) {
        var value = values[i];
        if (value !== undefined)
          newValue += value;
        newValue += tokens[i + 1];
      }

      return newValue;
    };
  }

  function setupBinding(node, name, tokens, model, delegate) {
    if (isSimpleBinding(tokens)) {
      return bindOrDelegate(node, name, model, tokens[1], delegate);
    }

    tokens.combinator = tokens.combinator || newTokenCombinator(tokens);

    var replacementBinding = new CompoundBinding(tokens.combinator);
    replacementBinding.scheduled = true;
    for (var i = 1; i < tokens.length; i = i + 2) {
      bindOrDelegate(replacementBinding, i, model, tokens[i], delegate);
    }
    replacementBinding.resolve();
    return node.bind(name, replacementBinding, 'value');
  }

  function parseAttributeBindings(element) {
    assert(element);

    var bindings;
    var isTemplateNode = isTemplate(element);
    var ifFound = false;
    var bindFound = false;

    for (var i = 0; i < element.attributes.length; i++) {
      var attr = element.attributes[i];
      var name = attr.name;
      var value = attr.value;

      if (isTemplateNode) {
        if (name === IF) {
          ifFound = true;
          value = value || '{{}}';  // Accept 'naked' if.
        } else if (name === BIND || name === REPEAT) {
          bindFound = true;
          value = value || '{{}}';  // Accept 'naked' bind & repeat.
        }
      }

      var tokens = parseMustacheTokens(value);
      if (!tokens)
        continue;

      bindings = bindings || [];
      bindings.push(name, tokens);
    }

    // Treat <template if> as <template bind if>
    if (ifFound && !bindFound) {
      bindings = bindings || [];
      bindings.push(BIND, parseMustacheTokens('{{}}'));
    }

    return bindings;
  }

  function getBindings(node) {
    if (node.nodeType === Node.ELEMENT_NODE)
      return parseAttributeBindings(node);

    if (node.nodeType === Node.TEXT_NODE) {
      var tokens = parseMustacheTokens(node.data);
      if (tokens)
        return ['textContent', tokens];
    }
  }

  function addMapBindings(node, bindings, model, delegate, bound) {
    if (!bindings)
      return;

    if (bindings.templateRef) {
      HTMLTemplateElement.decorate(node, bindings.templateRef);
      if (delegate) {
        templateBindingDelegateTable.set(node, delegate);
      }
    }

    if (bindings.length)
      processBindings(bindings, node, model, delegate, bound);

    if (!bindings.children)
      return;

    var i = 0;
    for (var child = node.firstChild; child; child = child.nextSibling) {
      addMapBindings(child, bindings.children[i++], model, delegate, bound);
    }
  }

  function addBindings(node, model, delegate) {
    assert(node);

    var bindings = getBindings(node);
    if (bindings)
      processBindings(bindings, node, model, delegate);

    for (var child = node.firstChild; child ; child = child.nextSibling)
      addBindings(child, model, delegate);
  }

  function deepCloneIgnoreTemplateContent(node, delegate) {
    var clone = node.cloneNode(false);
    if (isTemplate(clone)) {
      return clone;
    }

    for (var child = node.firstChild; child; child = child.nextSibling) {
      clone.appendChild(deepCloneIgnoreTemplateContent(child, delegate))
    }

    return clone;
  }

  function createInstanceBindingMap(node) {
    var map = getBindings(node);
    if (isTemplate(node)) {
      map = map || [];
      map.templateRef = node;
      map.hasSubTemplate = true;
    }

    var child = node.firstChild, index = 0;
    for (; child; child = child.nextSibling, index++) {
      var childMap = createInstanceBindingMap(child);
      if (!childMap)
        continue;

      map = map || [];
      map.children = map.children || {};
      map.children[index] = childMap;
      if (childMap.hasSubTemplate)
        map.hasSubTemplate = true;
    }

    return map;
  }

  function TemplateInstance(firstNode, lastNode, model) {
    // TODO(rafaelw): firstNode & lastNode should be read-synchronous
    // in cases where script has modified the template instance boundary.
    // All should be read-only.
    this.firstNode = firstNode;
    this.lastNode = lastNode;
    this.model = model;
  }

  function addTemplateInstanceRecord(fragment, model) {
    if (!fragment.firstChild)
      return;

    var instanceRecord = new TemplateInstance(fragment.firstChild,
                                              fragment.lastChild, model);
    var node = instanceRecord.firstNode;
    while (node) {
      templateInstanceTable.set(node, instanceRecord);
      node = node.nextSibling;
    }
  }

  var templateInstanceTable = new SideTable();

  Object.defineProperty(Node.prototype, 'templateInstance', {
    get: function() {
      var instance = templateInstanceTable.get(this);
      return instance ? instance :
          (this.parentNode ? this.parentNode.templateInstance : undefined);
    }
  });

  function CompoundBinding(combinator) {
    this.observers = {};
    this.values = {};
    this.value = undefined;
    this.size = 0;
    this.combinator_ = combinator;
    this.closed = false;
    this.scheduled = false;
  }

  CompoundBinding.prototype = {
    set combinator(combinator) {
      this.combinator_ = combinator;
      this.scheduleResolve();
    },

    pathValueChanged: function(value, oldValue, name) {
      this.values[name] = value;
      this.scheduleResolve();
    },

    bind: function(name, model, path) {
      this.unbind(name);

      this.size++;
      var observer = new PathObserver(model, path, this.pathValueChanged,
                                      this,
                                      name);
      this.observers[name] = observer;
      this.pathValueChanged(observer.value, undefined, name);
    },

    unbind: function(name, suppressResolve) {
      if (!this.observers[name])
        return;

      this.size--;
      this.observers[name].close();
      delete this.observers[name];
      delete this.values[name];
      if (!suppressResolve)
        this.scheduleResolve();
    },

    // TODO(rafaelw): Is this the right processing model?
    // TODO(rafaelw): Consider having a seperate ChangeSummary for
    // CompoundBindings so to excess dirtyChecks.
    scheduleResolve: function() {
      if (this.scheduled)
        return;
      this.scheduled = true;
      ensureScheduled(this);
    },

    resolve: function() {
      if (this.closed)
        return;

      if (!this.combinator_) {
        throw Error('CompoundBinding attempted to resolve without a ' +
                    'combinator');
      }

      this.value = this.combinator_(this.values);
      this.scheduled = false;
    },

    unobserved: function() {
      this.close();
    },

    close: function() {
      if (this.closed)
        return;

      Object.keys(this.observers).forEach(function(name) {
        this.unbind(name, true);
      }, this);

      this.closed = true;
      this.value = undefined;
    }
  };

  function TemplateIterator(templateElement) {
    this.closed = false;
    this.templateElement_ = templateElement;
    // Flattened array of tuples:
    //   <instanceTerminatorNode, [bindingsSetupByInstance]>
    this.terminators = [];
    this.iteratedValue = undefined;
    this.arrayObserver = undefined;
    this.inputs = new CompoundBinding(this.resolveInputs.bind(this));
    TemplateIterator.templateTable.set(this.templateElement_, this);
  }

  // "private"
  TemplateIterator.templateTable = new SideTable();

  TemplateIterator.get = function(template) {
    return TemplateIterator.templateTable.get(template);
  }

  TemplateIterator.getOrCreate = function(template) {
    return TemplateIterator.get(template) || new TemplateIterator(template);
  };

  TemplateIterator.prototype = {
    resolveInputs: function(values) {
      if (this.closed)
        return;

      if (IF in values && !values[IF])
        this.valueChanged(undefined);
      else if (REPEAT in values)
        this.valueChanged(values[REPEAT]);
      else if (BIND in values || IF in values)
        this.valueChanged([values[BIND]]);
      else
        this.valueChanged(undefined);
    },

    valueChanged: function(value) {
      if (!Array.isArray(value))
        value = undefined;

      var oldValue = this.iteratedValue;
      this.unobserve();
      this.iteratedValue = value;

      if (this.iteratedValue) {
        this.arrayObserver =
            new ArrayObserver(this.iteratedValue, this.handleSplices, this);
      }

      var splices = ArrayObserver.calculateSplices(this.iteratedValue || [],
                                                   oldValue || []);

      if (splices.length)
        this.handleSplices(splices);

      if (!this.inputs.size)
        this.close();
    },

    getTerminatorAt: function(index) {
      if (index == -1)
        return this.templateElement_;
      var terminator = this.terminators[index*2];
      if (terminator.nodeType !== Node.ELEMENT_NODE ||
          this.templateElement_ === terminator) {
        return terminator;
      }

      var subIterator = TemplateIterator.get(terminator);
      if (!subIterator)
        return terminator;

      return subIterator.getTerminatorAt(subIterator.terminators.length/2 - 1);
    },

    // TODO(rafaelw): If we inserting sequences of instances we can probably
    // avoid lots of calls to getTerminatorAt(), or cache its result.
    insertInstanceAt: function(index, fragment, instanceNodes, bound) {
      var previousTerminator = this.getTerminatorAt(index - 1);
      var terminator = previousTerminator;
      if (fragment)
        terminator = fragment.lastChild || terminator;
      else if (instanceNodes)
        terminator = instanceNodes[instanceNodes.length - 1] || terminator;

      this.terminators.splice(index*2, 0, terminator, bound);
      var parent = this.templateElement_.parentNode;
      var insertBeforeNode = previousTerminator.nextSibling;

      if (fragment) {
        parent.insertBefore(fragment, insertBeforeNode);
      } else if (instanceNodes) {
        for (var i = 0; i < instanceNodes.length; i++)
          parent.insertBefore(instanceNodes[i], insertBeforeNode);
      }
    },

    extractInstanceAt: function(index) {
      var instanceNodes = [];
      var previousTerminator = this.getTerminatorAt(index - 1);
      var terminator = this.getTerminatorAt(index);
      instanceNodes.bound = this.terminators[index*2 + 1];
      this.terminators.splice(index*2, 2);

      var parent = this.templateElement_.parentNode;
      while (terminator !== previousTerminator) {
        var node = previousTerminator.nextSibling;
        if (node == terminator)
          terminator = previousTerminator;

        parent.removeChild(node);
        instanceNodes.push(node);
      }

      return instanceNodes;
    },

    getInstanceModel: function(template, model, delegate) {
      var delegateFunction = delegate && delegate[GET_INSTANCE_MODEL];
      if (delegateFunction && typeof delegateFunction == 'function')
        return delegateFunction(template, model);
      else
        return model;
    },

    handleSplices: function(splices) {
      if (this.closed)
        return;

      var template = this.templateElement_;
      if (!template.parentNode || !template.ownerDocument.defaultView) {
        this.close();
        return;
      }

      var delegate = template.bindingDelegate;

      var instanceCache = new Map;
      var removeDelta = 0;
      splices.forEach(function(splice) {
        splice.removed.forEach(function(model) {
          var instanceNodes =
              this.extractInstanceAt(splice.index + removeDelta);
          instanceCache.set(model, instanceNodes);
        }, this);

        removeDelta -= splice.addedCount;
      }, this);

      splices.forEach(function(splice) {
        var addIndex = splice.index;
        for (; addIndex < splice.index + splice.addedCount; addIndex++) {
          var model = this.iteratedValue[addIndex];
          var fragment = undefined;
          var instanceNodes = instanceCache.get(model);
          var bound;
          if (instanceNodes) {
            instanceCache.delete(model);
            bound = instanceNodes.bound;
          } else {
            bound = [];
            var actualModel = this.getInstanceModel(template, model, delegate);
            if (model !== undefined) {
              fragment = this.templateElement_.createInstance(actualModel,
                                                              delegate,
                                                              bound);
            }
          }

          this.insertInstanceAt(addIndex, fragment, instanceNodes, bound);
        }
      }, this);

      instanceCache.forEach(function(instanceNodes) {
        this.closeInstanceBindings(instanceNodes.bound);
      }, this);
    },

    closeInstanceBindings: function(bound) {
      for (var i = 0; i < bound.length; i++) {
        bound[i].close();
      }
    },

    unobserve: function() {
      if (!this.arrayObserver)
        return;

      this.arrayObserver.close();
      this.arrayObserver = undefined;
    },

    close: function() {
      if (this.closed)
        return;
      this.unobserve();
      for (var i = 1; i < this.terminators.length; i += 2) {
        this.closeInstanceBindings(this.terminators[i]);
      }

      this.terminators.length = 0;
      this.inputs.close();
      TemplateIterator.templateTable.delete(this.templateElement_);
      this.closed = true;
    }
  };

  global.CompoundBinding = CompoundBinding;

  // Polyfill-specific API.
  HTMLTemplateElement.forAllTemplatesFrom_ = forAllTemplatesFrom;
})(this);
