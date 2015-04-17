define(['Observable', 'Logging', 'StringUtils', 'FnUtils', 'jquery'], function (Observable, Logging, StringUtils, FnUtils, $) {
    var createDelegate,
        Plugin;

    /**
     * Creates a plugin system delegate for the given function
     *
     * @param fnName
     * @returns {Function}
     */
    createDelegate = function createSystemDelegate (delegate, fnName) {
        return function () {
            delegate[fnName].apply(delegate, arguments);
        };
    };

    /**
     * Plugin base class
     *
     * @class Plugin
     * @augments Observable
     */
    Plugin = Observable.extend(/**@lends Plugin.prototype*/{
        $element: null,
        name: 'Plugin',
        logger: null,
        boundMessages: {},
        /**
         * The plugin's constructor
         *
         * @param {Object} options The configuration options for the plugin
         * @param {DOMElement} element The DOM element to apply the plugin to
         * @param {PluginManager} system The PluginManager to delegate system events to, etc.
         */
        constructor: function (options, element, system) {
            var me = this;
            me.boundMessages = {};

            me.logger = Logging.getLogger(me.name + '(Plugin)');

            if (element) {
                me.applyElement(element);
            }

            if (system) {
                me.attachSystemDelegates(system);
                me.attachSystemListeners();
            }

            this.base();

            if (options) {
                me.reconfigure(options);
            }
        },
        /**
         * Attaches listeners to the global plugin system
         *
         * @private
         */
        attachSystemListeners: function () {
            var me = this;

            me.onSystemMessage('prepared', me.onSystemPrepared, me);
            me.onSystemMessage('ready', me.onSystemReady, me);
            me.onSystemMessage('pluginsexecuted', me.onPluginsExecuted, me);
        },
        /**
         * Lazyly attaches the system delegate functions after system has been injected
         *
         * @private
         * @param {PluginManager} system
         */
        attachSystemDelegates: function (system) {
            var me = this;

            me.onSystemMessage = createDelegate(system, 'on');
            me.unSystemMessage = createDelegate(system, 'un');
            me.sendSystemMessage = createDelegate(system, 'fire');
        },
        /**
         * Applies given element to the plugin and automatically
         * generates the relevant jQuery object for it which accessible
         * via this.$element afterwards
         *
         * @param {DOMElement} element
         * @private
         */
        applyElement: function (element) {
            var me = this;

            if (element) {
                me.$element = $(element);
            }
        },

        /**
         * Event listener for the plugin system's prepared event
         * which will initialize the plugin
         *
         * @private
         */
        onSystemPrepared: function () {
            var me = this;

            me.unSystemMessage('prepared', me.onSystemPrepared, me);
            try {
                me.init();
            } catch (e) {
                me.logger.error(StringUtils.format(
                   'Error while initializing Plugin {0}: {1}',
                   me.name,
                   e.message
                ));
            }

            // fire event although an error occured to keep the system running
            me.fire('initialized');
        },

        /**
         * Event listener for the plugin system's ready event
         * which will execute the plugin
         *
         * @private
         */
        onSystemReady: function () {
            var me = this,
                dfd = $.Deferred(),
                result;

            me.unSystemMessage('ready', me.onSystemReady, me);
            try {
                result = me.execute(dfd);
            } catch (e) {
                me.logger.error(StringUtils.format(
                    'Error while executing Plugin {0}: {1}',
                    me.name,
                    e.message
                ));
            }

            // fire event although an error occured to keep system running
            if (!result) {
                me.fire('executed');
            } else {
                $.when(result).done(function () {
                    me.fire('executed');
                });
            }
        },
        /**
         * Returns any child element according to the given selector
         * using the instances element as parent
         *
         * @param {String} selector The selector of the child's element to fetch
         * @returns {jQuery}
         */
        $child: function (selector) {
            return $(selector, this.$element);
        },
        /**
         * Destroys the plugin
         */
        destroy: function () {
            var me = this;
            // clear local listeners
            me.unbindSystemMessage();
            me.logger = undefined;
        },

        /**
         * Initializes the plugin / prepares it for execution
         */
        init: function () {},
        /**
         * Executes the plugin. Either you can just implement the function
         * then the plugin event "executed" will be propagated immediately.
         *
         * If want to make use of the given dfd object, just use it inside the
         * function and return it, then it will wait for the promise to be fulfilled
         *
         * @param {Object} dfd The optional deferrable
         */
        execute: function (dfd) {
            if (dfd) {
                dfd.resolve();
            }

            return dfd;
        },

        /**
         * Private function which will be called after all plugins have been executed by the system
         * @private
         */
        onPluginsExecuted: function () {
            var me = this;
            me.unSystemMessage('pluginsexecuted', me.onPluginsExecuted, me);
            me.onFinished();
        },

        /**
         * Binds the function of this plugin by given name
         *
         * @param {String} fnName The name of the function of this plugin
         * @param {Array} additionalArgs Additional arguments to call, when the function is called
         * @param {Boolean} appendArgs Whether to append additional arguments or override the original ones
         *
         * @returns {Function} Resulting function bound to this instance
         */
        bind: function (fn, additionalArgs, appendArgs) {
            var me = this,
                local = false,
                message;

            // if given fn is a string, bind to local function with that name
            if (StringUtils.isString(fn)) {
                local = fn;
                fn = me[fn];
            }

            if (!FnUtils.isFn(fn)) {
                if (local) {
                    message = StringUtils.format(
                        'Given local function does neither exist nor is a function. ' +
                        'Could not bind local function {0}.{1}',
                        me.name,
                        local
                    );
                } else {
                    message = StringUtils.format(
                        'Given function does either not exist or ain\'t a function. ' +
                        'Could not bind to function in Plugin {0}',
                        me.name
                    );
                }

                throw new Error(message);
            }

            return FnUtils.bind(fn, me, additionalArgs, appendArgs);
        },

        /**
         * Binds given system message to given function
         *
         * @param {String} event Name of the event
         * @param {String} fn Name of the local function to bind this event to
         * @param {Array} additionalArgs Additional arguments to call, when the function is called
         * @param {Boolean} appendArgs Whether to append additional arguments or override the original ones
         */
        bindSystemMessage: function (event, fn, additionalArgs, appendArgs) {
            var me = this,
               callable;

            if (!StringUtils.isString(fn)) {
                throw new Error(StringUtils.format(
                   'You only may bind functions of your plugin using a string for function definition. ' +
                   'If you want to use another source, please use this.onSystemMessage(\'eventName\', this.bind(yourFn)) instead'
                ));
            }

            callable = this.bind(fn, additionalArgs, appendArgs);

            me.boundMessages = me.boundMessages || {};
            me.boundMessages[event] = me.boundMessages[event] || {};
            me.boundMessages[event][fn] = callable;

            me.onSystemMessage(event, callable);
        },

        /**
         * Unbinds given system message from given function
         *
         * @param {String} event The event to remove the listener from
         * @param {String} fn The listener function name to unbind
         */
        unbindSystemMessage: function (event, fn) {
            var me = this,
                callable;

            if (!event) {
                for (var e in me.boundMessages) {
                    me.unbindSystemMessage(e);
                }
                return;
            }

            if (!fn) {
                for (var c in me.boundMessages[event]) {
                    me.unbindSystemMessage(event, c);
                }
                return;
            }

            if (me.boundMessages[event] && me.boundMessages[event][fn]) {
                callable = me.boundMessages[event][fn];
                // unbind the function
                me.unSystemMessage(event, callable);
                // delete the reference to the function
                delete me.boundMessages[event][fn];
                // if this event has no more listeners, delete the event scope
                if (!me.boundMessages[event].length) {
                    delete me.boundMessages[event];
                }
            } else {
                throw new Error(StringUtils.format(
                    'Could not unbind function {0}.{1} from system message "{2}" ' +
                    'because this combination does not exist',
                    me.name,
                    fn,
                    event
                ));
            }
        },
        /**
         * Public function which will be called after all plugins have been executed by the system
         */
        onFinished: function () {

        },

        /**
         * Adds an event listener to the plugin system
         *
         * @param {String} eventName Event to listen to
         * @param {Function} callback Function to handle the event
         * @param {Object} scope Scope for the callback function
         */
        onSystemMessage: function () {},
        /**
         * Removes an event listener from the plugin system
         *
         * @param {String} eventName Event to remove the listener function from
         * @param {Function} callback Function to handle the event
         * @param {Object} scope Scope for the callback function
         */
        unSystemMessage: function () {},
        /**
         * Fires an event to the plugin system (global message bus)
         *
         * @param {String} eventName Event to fire (message type)
         * @param {Attributes} Several attributes, just what you want to send
         */
        sendSystemMessage: function () {}
    });

    return Plugin;
});
