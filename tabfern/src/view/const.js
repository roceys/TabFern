// view/const.js: constants and generic helpers for the TabFern view
// Copyright (c) 2017 Chris White, Jasmine Hegman.

(function (root, factory) {
    let imports=['jquery','jstree','loglevel','asynquence-contrib',
                    'asq-helpers' ];

    if (typeof define === 'function' && define.amd) {
        // AMD
        define(imports, factory);
    } else if (typeof exports === 'object') {
        // Node, CommonJS-like
        let requirements = [];
        for(let modulename of imports) {
            requirements.push(require(modulename));
        }
        module.exports = factory(...requirements);
    } else {
        // Browser globals (root is `window`)
        let requirements = [];
        for(let modulename of imports) {
            requirements.push(root[modulename]);
        }
        root.tabfern_const = factory(...requirements);
    }
}(this, function ($, _unused_jstree_placeholder_, log_orig, ASQ, ASQH ) {
    "use strict";

    function loginfo(...args) { log_orig.info('TabFern view/const.js: ', ...args); };

    /// The module we are creating
    let module = {
        STORAGE_KEY: 'tabfern-data',
            ///< Store the saved windows/tabs
        LOCN_KEY: 'tabfern-window-location',
            ///< Store where the tabfern popup is
        LASTVER_KEY: 'tabfern-last-version',
            ///< Store the last version used on this system, for showing a
            ///< "What's New" notification

        SAVE_DATA_AS_VERSION: 1,       // version we are currently saving

        //BORDERED_TAB_CLASS: 'tabfern-tab-bordered',     // class on <li>s with a top border
        //FOCUSED_WIN_CLASS: 'tf-focused-window',  // Class on the currently-focused win
        //VISIBLE_WIN_CLASS: 'tf-visible-window',  // Class on all visible wins

        SHOW_ACTIONS_CLASS:  'tf-show-actions',
            // Class on a .jstree-node to indicate its actions should be shown

        BULLET_CLASS: 'tf-bullet',      // class on spans showing bullets for items
        CLASS_RECOVERED:  'ephemeral-recovered',

        INIT_TIME_ALLOWED_MS:  3000,  // After this time, if init isn't done,
                                            // display an error message.
        INIT_MSG_SEL:  'div#init-incomplete',     // Selector for that message

        ACTION_GROUP_WIN_CLASS: 'tf-action-group',   // Class on action-group div
        ACTION_BUTTON_WIN_CLASS: 'tf-action-button', // Class on action buttons (<i>)

        /// How often to check whether our window has been moved or resized
        RESIZE_DETECTOR_INTERVAL_MS:  5000,

        /// This many ms after mouseout, a context menu will disappear
        CONTEXT_MENU_MOUSEOUT_TIMEOUT_MS:  1500,

        // --- Syntactic sugar ---
        WIN_KEEP:  true,    // must be truthy
        WIN_NOKEEP:  false, // must be falsy
        NONE:  chrome.windows.WINDOW_ID_NONE,
            ///< Do not assume that NONE and WINDOW_ID_NONE will always be the same!

        // Item-type enumeration.  Here because there may be more item
        // types in the future (e.g., dividers or plugins).  Each IT_*
        // must be truthy.  These are used as the types in multidexes.
        // They are also applied to nodes using jstree-multitype.
        IT_WIN:  'win',      // strings are used as required by multidex
        IT_TAB:     'tab',

        // Node subtypes that can be layered onto the basic node types using jstree-multitype
        NST_OPEN:           'open',     // Present if a window or tab is open
        NST_SAVED:          'saved',    // Present if a window or tab has been saved

        NST_RECOVERED:      'recovered',    // Present on windows recovered from a crash

        NST_TOP_BORDER:     'top-bordered', // Present on tabs that have a top border
    };

    /// Make a callback function that will forward to #fn on a later tick.
    /// @param fn {function} the function to call
    module.nextTickRunner = function(fn) {
        function inner(...args) {   // the actual callback
            setTimeout( function() { fn(...args); } ,0);
                // on a later tick, call #fn, passing it the arguments the
                // actual callback (inner()) got.
        }
        return inner;
    } //nextTickRunner()

    /// Open a new window with a given URL.  Also remove the default
    /// tab that appears because we are letting the window open at the
    /// default size.  Yes, this is a bit like a FOUC, but oh well.
    module.openWindowForURL = function(url) {
        let win_id;     // TODO is there a better way to pass data down
                        // the sequence?
        let tab0_id;    ///< The tab automatically created with the window

        ASQH.NowCC((cc)=>{
            chrome.windows.create(cc);
        })
        .then(function open_tab(done, new_win){
            win_id = new_win.id;
            tab0_id = new_win.tabs[0].id;
            chrome.tabs.create({windowId: win_id, url: url}, ASQH.CC(done));
        })
        .then(function remove_old_tab(done){
            chrome.tabs.remove(tab0_id, ASQH.CC(done));
        })
        .or(function(err){log_orig.error({'Load error':err, url});})
        ;

        // To start the sequence paused, use `let seq = ASQ().duplicate()` above
        // instead of just ASQ().  Then, to fire it off, `seq.unpause();`.

    } //openWindowForURL

    return Object.freeze(module);   // all fields constant
}));

// vi: set ts=4 sts=4 sw=4 et ai fo-=o fo-=r: //
