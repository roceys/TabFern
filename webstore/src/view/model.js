// view/model.js: Routines for managing items as a whole (both tree nodes
// and detail records).  Part of TabFern.
// Copyright (c) 2017--2018 Chris White, Jasmine Hegman.

// The item module enforces that invariant that, except during calls to these
// routines, each node in the treeobj has a 1-1 relationship with a value in
// the details.  The treeobj, including its DOM, is part of the model.

/// Hungarian elements used in this file:
/// - vn: a {val, node_id} object
/// - vorn: a val, or a node_id
/// - n: a jstree node_id
/// - ny: anything that can be passed to jstree.get_node() ("nodey" by
///   analogy with "truthy" and "falsy."
/// - vorny: a val or a nodey

// Boilerplate {{{1

(function (root, factory) {
    let imports=['jquery','jstree','loglevel', 'view/const',
                    'view/item_details', 'view/item_tree', 'justhtmlescape',
                    'buffer', 'blake2s'];

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
        root.tabfern_item = factory(...requirements);
    }
}(this, function ($, _unused_jstree_placeholder_, log, K, D, T, Esc,
                    Buffer, BLAKE2s) {
    "use strict";

    function loginfo(...args) { log.info('TabFern view/item.js: ', ...args); };
    // }}}1

    /// The module we are creating
    let module = {};

    /// Value returned by vn*() on error.  Both members are falsy.
    module.VN_NONE = {val: null, node_id: ''};

    // Querying the model ////////////////////////////////////////////// {{{1

    /// Get a {val, node_id} pair (vn) from one of those (vorny).
    /// @param val_or_nodey {mixed} If a string, the node ID of the
    ///                             item; otherwise, the details
    ///                             record for the item, or the jstree node
    ///                             record for the node.
    /// @param item_type {mixed=} If provided, the type of the item.
    ///             Otherwise, all types will be checked.
    /// @return {Object} {val, node_id}.    `val` is falsy if the
    ///                                     given vorny was not found.
    module.vn_by_vorny = function(val_or_nodey, item_type) {
        if(!val_or_nodey) return module.VN_NONE;

        let val, node_id;
        if(typeof val_or_nodey === 'string') {          // a node_id
            node_id = val_or_nodey;
            switch(item_type) {
                case K.IT_WIN:
                    val = D.windows.by_node_id(node_id); break;
                case K.IT_TAB:
                    val = D.tabs.by_node_id(node_id); break;
                default:
                    val = D.val_by_node_id(node_id); break;
            }

        } else if(typeof val_or_nodey === 'object' && val_or_nodey.id &&
                val_or_nodey.parent) {                  // A jstree node
            node_id = val_or_nodey.id;
            val = D.val_by_node_id(node_id);

        } else if(typeof val_or_nodey === 'object' &&   // A val (details record)
                val_or_nodey.ty) {
            val = val_or_nodey;
            if(!val.node_id) return module.VN_NONE;
            node_id = val.node_id;
        } else {                                        // Unknown
            return module.VN_NONE;
        }

        return {val, node_id};
    } //vn_by_vorny

    /// Determine whether a model has given subtype(s).
    /// @param vorny {mixed} The item
    /// @param tys {mixed} A single type or array of types
    /// @return {Boolean} true if #vorny has all the subtypes in #tys;
    ///                     false otherwise.
    module.has_subtype = function(vorny, ...tys) {
        if(!vorny || !tys) return false;
        if(tys.length < 1) return false;
        let {node_id} = module.vn_by_vorny(vorny);
        if(!node_id) return false;

        for(let ty of tys) {
            if(!T.treeobj.has_multitype(node_id, ty)) return false;
        }
        return true;
    } //has_subtype

    // }}}1
    // Data-access routines //////////////////////////////////////////// {{{1

    /// Find a node's value in the model, regardless of type.
    /// @param node_ref {mixed} If a string, the node id; otherwise, anything
    ///                         that can be passed to jstree.get_node.
    /// @return ret {object} the value, or ===false if the node wasn't found.
    module.get_node_val = function(node_ref)
    {
        // Get the node ID
        let node_id;

        if(typeof node_ref === 'string') {
            node_id = node_ref;
        } else {
            let node = T.treeobj.get_node(node_ref);
            if(node === false) return false;
            node_id = node.id;
        }

        return D.val_by_node_id(node_id);
    }; //get_node_val()

    /// Get the textual version of raw_title for a window's value
    module.get_win_raw_text = function(val)
    {
        if(val.raw_title !== null) {
            return val.raw_title;
        } else if(val.keep) {
            return 'Saved tabs';
        } else {
            return 'Unsaved';
        }
    }; //get_win_raw_text()

    /// Mark window item #val as unsaved (forget #val).
    /// @param val {Object} the item
    /// @param adjust_title {Boolean=true} Add unsaved markers if truthy
    /// @return {Boolean} true on success; false on error
    module.mark_win_as_unsaved = function(val, adjust_title=true) {
        if(!val || val.ty !== K.IT_WIN || !val.node_id) return false;

        val.keep = K.WIN_NOKEEP;
        T.treeobj.del_multitype(val.node_id, K.NST_SAVED);

        if(adjust_title && (val.raw_title !== null)) {
            val.raw_title = module.remove_unsaved_markers(val.raw_title) +
                            ' (Unsaved)';
        }
        // If raw_title is null, get_win_raw_text() will return 'Unsaved',
        // so we don't need to manually assign text here.

        module.refresh_label(val.node_id);
        module.refresh_icon(val);
        return true;
    }; //mark_as_unsaved()

    /// Remove " (Unsaved)" flags from a string
    /// @param str {mixed} A string, or falsy.
    /// @return
    ///     If #str is falsy, a copy of #str.
    //      Otherwise, #str as a string, without the markers if any were present
    module.remove_unsaved_markers = function(str) {
        if(!str) return str;
        str = str.toString();
        let re = /(\s+\(Unsaved\)){1,}\s*$/i;
        let matches = str.match(re);
        if(matches && matches.index > 0) {
            return str.slice(0,matches.index);
        } else {
            return str;
        }
    };

    /// Get the HTML for the node's label.  The output can be passed
    /// directly to jstree.rename_node().
    /// @param val The multidex value for the item of interest
    /// @return A string
    module.get_html_label = function(val) {
        let retval = '';
        if(val.isPinned) {  // TODO make this optional?
            retval += '&#x1f4cc;&nbsp;';    // PUSHPIN
        }

        let raw_text = module.get_win_raw_text(val);
        if(val.raw_bullet && typeof val.raw_bullet === 'string') {
            // The first condition checks for null/undefined/&c., and also for
            // empty strings.
            retval += '<span class="' + K.BULLET_CLASS + '">';
            retval += Esc.escape(val.raw_bullet);

            // Add a dingbat if there is text to go on both sides of it.
            if(raw_text && raw_text !== "\ufeff") {
                // \ufeff is a special case for the Empty New Tab Page
                // extension, which cxw42 has been using for some years now.
                retval += ' &#x2726; ';   // the dingbat
            }

            retval += '</span>';
        }

        retval += Esc.escape(raw_text);
        return retval;
    };

    // }}}1
    // Item manipulation /////////////////////////////////////////////// {{{1

    /// Update the tree-node text for an item.
    /// @param node_id {string} the node's ID (which doubles as the item's id)
    /// @return truthy on success, falsy on failure.
    module.refresh_label = function(node_id) {
        if(!node_id) return false;
        let val = D.val_by_node_id(node_id);
        if(!val) return false;
        let retval = T.treeobj.rename_node(node_id, module.get_html_label(val));

        return retval;
    };

    /// Update the icon of #vorny
    /// @param vorny {Mixed} The item
    /// @return {Boolean} true on success; false on error
    module.refresh_icon = function(vorny) {
        let {val, node_id} = module.vn_by_vorny(vorny);
        let node = T.treeobj.get_node(node_id);
        if(!val || !node_id || !node) return false;

        let icon;

        switch(val.ty) {
            case K.IT_TAB:
                icon = 'fff-page';
                if(val.raw_favicon_url) {
                    icon = encodeURI(val.raw_favicon_url);
                } else if((/\.pdf$/i).test(val.raw_url)) {  //special-case PDFs
                    icon = 'fff-page-white-with-red-banner';
                }
                break;

            case K.IT_WIN:
                icon = true;    // default icon for closed windows
                if(val.isOpen && val.keep) {    // open and saved
                    icon = 'fff-monitor-add';
                } else if(val.isOpen) {         // ephemeral
                    icon = 'fff-monitor';
                }
                break;

            default:
                return false;
        }

        if(!icon) return false;

        T.treeobj.set_icon(node, icon);

        // TODO? if the favicon doesn't load, replace the icon with the
        // generic page icon so we don't keep hitting the favIconUrl.

        return true;
    } //refresh_icon

    /// Mark the window identified by #win_node_id as to be kept.
    /// @param win_node_id {string} The window node ID
    /// @param cleanup_title {optional boolean, default true}
    ///             If true, remove unsaved markers from the raw_title.
    /// @return {Boolean} true on success; false on error
    module.remember = function(win_node_id, cleanup_title = true) {
        if(!win_node_id) return false;
        let val = D.windows.by_node_id(win_node_id);
        if(!val) return false;

        val.keep = K.WIN_KEEP;
        T.treeobj.add_multitype(win_node_id, K.NST_SAVED);

        if(cleanup_title) {
            val.raw_title = module.remove_unsaved_markers(
                    module.get_win_raw_text(val));
        }

        module.refresh_label(win_node_id);
        module.refresh_icon(val);
        return true;
    }; //remember()

    // }}}1
    // #####################################################################
    // #####################################################################
    // New routines: item (tree+details) as model; Chrome itself as view.
    //
    // "Rez" and "Erase" are adding/removing items, to distinguish them
    // from creating and destroying Chrome widgets.

    // Hashing routines //////////////////////////////////////////////// {{{1

    // Hash the strings in #strs together.  All strings are encoded in utf8
    // before hashing.
    // @param strs {mixed} a string or array of strings.
    // @return {String} the hash, as a string of hex chars
    module.orderedHashOfStrings = function(strs) {
        if(!Array.isArray(strs)) strs = [strs];
        let blake = new BLAKE2s(32);
        for(let str of strs) {
            let databuf = new Uint8Array(Buffer.from(str + '\0', 'utf8'));
                // Design choice: append \0 so each string has nonzero length
            blake.update(databuf);
        }
        return blake.hexDigest();
    } //orderedHashOfStrings

    /// Update the given node's ordered_url_hash to reflect its current children.
    /// @return {Boolean} True if the ordered_url_hash was set or was
    ///                     unchanged; false if neither of those holds.
    ///                     On false return, the ordered_url_hash
    ///                     will have been set to a falsy value.
    module.updateOrderedURLHash = function(vornyParent) {
        let {val: parent_val, node_id: parent_node_id} =
            module.vn_by_vorny(vornyParent, K.IT_WIN);
        let parent_node = T.treeobj.get_node(parent_node_id);
        if(!parent_val || !parent_node_id || !parent_node) return false;

        let child_urls = [];
        for(let child_node_id of parent_node.children) {
            let child_url = D.tabs.by_node_id(child_node_id, 'raw_url');
            if(!child_url) {   // rather than inconsistent state, just clear it
                D.windows.change_key(parent_val, 'ordered_url_hash', null);
                return false;
            }
            child_urls.push(child_url);
        }

        let ordered_url_hash = module.orderedHashOfStrings(child_urls);

        // Check if a different window already has that hash.  If so, that
        // window keeps that hash.
        let other_win_val = D.windows.by_ordered_url_hash(ordered_url_hash);

        if(Object.is(parent_val, other_win_val)) {
            return true;    // it's already us :)
        } else if(other_win_val) {
            D.windows.change_key(parent_val, 'ordered_url_hash', null);
                // This window will no longer participate in merge detection.
            return false;
        } else {
            D.windows.change_key(parent_val, 'ordered_url_hash', ordered_url_hash);
            return true;
        }
    }; //updateOrderedURLHash()

    // }}}1
    ////////////////////////////////////////////////////////////////////
    // Initializing and shutting down the model

    // TODO add a function that wraps T.create() so the user of model does
    // not have to directly access T to kick things off.

    // Adding model items ////////////////////////////////////////////// {{{1

    /// Add a model node/item for a window.  Does not process Chrome
    /// widgets.  Instead, assumes the tab is closed initially.
    ///
    /// @param isFirstChild {Boolean} [false] If truthy, the new node will be
    ///     the first child of its parent; otherwise, the last child.
    /// @return {Object} {val, node_id} The new item,
    ///                                 or module.VN_NONE on error.
    module.vnRezWin = function(isFirstChild=false) {
        let node_id = T.treeobj.create_node(
                $.jstree.root,
                { text: 'Window' },
                (isFirstChild ? 1 : 'last')
                    // 1 => after the holding pen (T.holding_node_id)
        );
        if(node_id === false) return module.VN_NONE;

        T.treeobj.add_multitype(node_id, K.IT_WIN);

        let val = D.windows.add({
            win_id: K.NONE,
            node_id: node_id,
            win: undefined,
            raw_title: null,
            raw_bullet: null,
            isOpen: false,
            keep: undefined
        });

        if(!val) {
            T.treeobj.delete_node(node_id);
            return module.VN_NONE;
        }

        module.refresh_label(node_id);
        module.refresh_icon(val);

        return {val, node_id};
    } //vnRezWin

    /// Add a model node/item for a tab, with the given parent.
    /// Does not process Chrome widgets.  Instead, assumes the tab is
    /// closed initially.
    ///
    /// @param {mixed} vornyParent The parent
    /// @return {Object} {val, node_id} The new item,
    ///                                 or module.VN_NONE on error.
    module.vnRezTab = function(vornyParent) {
        let {val: parent_val, node_id: parent_node_id} =
            module.vn_by_vorny(vornyParent);
        if(!parent_val || !parent_node_id) return module.VN_NONE;

        // Sanity check that the node also exists
        let parent_node = T.treeobj.get_node(parent_node_id);
        if(!parent_node) return module.VN_NONE;

        let node_id = T.treeobj.create_node(
                parent_node,
                { text: 'Tab' }
        );
        if(node_id === false) return module.VN_NONE;

        T.treeobj.add_multitype(node_id, K.IT_TAB);

        let val = D.tabs.add({
            tab_id: K.NONE,
            node_id: node_id,
            win_id: K.NONE,
            index: K.NONE,
            tab: undefined,
            isOpen: false,
            isPinned: false,
        });

        if(!val) {
            T.treeobj.delete_node(node_id);
            return module.VN_NONE;
        }

        module.refresh_label(node_id);
        module.refresh_icon(val);

        return {val, node_id};
    } //vnRezTab

    // }}}1
    // Updating model items //////////////////////////////////////////// {{{1

    /// Add a subtype (K.NST_*) to an item.
    /// @param vorny {mixed} The item
    /// @param tys {mixed} A single type or array of types
    /// @return {Boolean} true on success; false on error
    module.add_subtype = function(vorny, ...tys) {
        if(!vorny || !tys) return false;
        if(tys.length < 1) return false;
        let {node_id} = module.vn_by_vorny(vorny);
        if(!node_id) return false;

        for(let ty of tys) {
            T.treeobj.add_multitype(node_id, ty);
                // TODO report failure to add a type?
        }
        return true;
    } //add_subtype

    /// Remove a subtype (K.NST_*) from an item.
    /// @param vorny {mixed} The item
    /// @param tys {mixed} A single type or array of types
    /// @return {Boolean} true on success; false on error
    module.del_subtype = function(vorny, ...tys) {
        if(!vorny || !tys) return false;
        if(tys.length < 1) return false;
        let {node_id} = module.vn_by_vorny(vorny);
        if(!node_id) return false;

        for(let ty of tys) {
            T.treeobj.del_multitype(node_id, ty);
                // TODO report failure to remove a type?
        }
        return true;
    } //add_subtype

    // }}}1
    // Attaching Chrome widgets to model items ///////////////////////// {{{1

    /// Attach a Chrome window to an existing window item.
    /// Updates the item, but does not touch the Chrome window.
    /// @param win_vorny {mixed} The item
    /// @param cwin {Chrome Window} The open window
    /// @return {Boolean} true on success; false on error
    module.markWinAsOpen = function(win_vorny, cwin) {
        if(!win_vorny || !cwin || !cwin.id) return false;

        let {val, node_id} = module.vn_by_vorny(win_vorny, K.IT_WIN);
        if(!val || !node_id) return false;

        if(val.isOpen || val.win) {
            log.info({'Refusing to re-mark already-open window as open':val});
            return false;
        }

        let node = T.treeobj.get_node(node_id);
        if(!node) return false;

        T.treeobj.open_node(node_id);
            // We always open nodes for presently-open windows.  However, this
            // won't work if no tabs have been added yet.

        D.windows.change_key(val, 'win_id', cwin.id);
        // node_id unchanged
        val.win = cwin;
        // raw_title unchanged (TODO is this the Right Thing?)
        val.isOpen = true;
        // keep unchanged
        // raw_bullet unchanged

        T.treeobj.add_multitype(node_id, K.NST_OPEN);

        module.refresh_label(node_id);
        module.refresh_icon(val);

        return true;
    } //markWinAsOpen

    /// Attach a Chrome tab to an existing tab item.
    /// Updates the item, but does not touch the Chrome tab.
    /// As a result, the item takes values from the tab.
    /// ** NOTE ** Does NOT update the parent's val.ordered_url_hash.
    /// ** NOTE ** Does NOT attach any child nodes to tabs.
    /// @param tab_vorny {mixed} The item
    /// @param ctab {Chrome Tab} The open tab
    /// @return {Boolean} true on success; false on error
    module.markTabAsOpen = function(tab_vorny, ctab) {
        if(!tab_vorny || !ctab || !ctab.id) return false;

        let {val, node_id} = module.vn_by_vorny(tab_vorny, K.IT_TAB);
        if(!val || !node_id) return false;

        if(val.isOpen || val.tab) {
            log.info({'Refusing to re-mark already-open tab as open':val});
            return false;
        }

        let node = T.treeobj.get_node(node_id);
        if(!node) return false;

        D.tabs.change_key(val, 'tab_id', ctab.id);
        // It already has a node_id
        val.win_id = ctab.windowId;
        val.index = ctab.index;
        val.tab = ctab;
        // val.being_opened unchanged
        val.raw_url = ctab.url;
        val.raw_title = ctab.title;
        val.isOpen = true;
        // val.raw_bullet is unchanged since it doesn't come from ctab
        val.raw_favicon_url = ctab.favIconUrl;
        val.isPinned = !!ctab.pinned;

        T.treeobj.add_multitype(node_id, K.NST_OPEN);

        module.refresh_label(node_id);
        module.refresh_icon(val);   // since favicon may have changed

        // Design decision: tree items for open windows always start expanded.
        // No one has requested any other behaviour, as of the time of writing.
        T.treeobj.open_node(node.parent);

        return true;
    } //markTabAsOpen

    // }}}1
    // Removing Chrome widgets from model items //////////////////////// {{{1

    /// Remove the connection between #win_vorny and its Chrome window.
    /// Use this when the Chrome window has been closed.
    /// @param win_vorny {mixed} The item
    /// @return {Boolean} true on success; false on error
    module.markWinAsClosed = function(win_vorny) {
        if(!win_vorny) return false;

        let {val, node_id} = module.vn_by_vorny(win_vorny, K.IT_WIN);
        if(!val || !node_id) return false;

        if(!val.isOpen || !val.win) {
            log.info({'Refusing to re-mark already-closed window as closed':val});
            return false;
        }

        D.windows.change_key(val, 'win_id', K.NONE);
        // node_id unchanged
        val.win = undefined;
        // raw_title unchanged
        val.isOpen = false;
        // keep unchanged - this is an unmark, not an erase.
        // raw_bullet unchanged

        T.treeobj.del_multitype(node_id, K.NST_OPEN);

        module.refresh_label(node_id);
        module.refresh_icon(val);

        return true;
    } //markWinAsClosed

    /// Remove the connection between #tab_vorny and its Chrome tab.
    /// Use this when the Chrome tab has been closed.
    /// NOTE: does not handle saved/unsaved at this time.  TODO should it?
    /// @param tab_vorny {mixed} The item
    /// @return {Boolean} true on success; false on error
    module.markTabAsClosed = function(tab_vorny) {
        if(!tab_vorny) return false;

        let {val, node_id} = module.vn_by_vorny(tab_vorny, K.IT_TAB);
        if(!val || !node_id) return false;
        let node = T.treeobj.get_node(node_id);
        if(!node) return false;

        if(!val.isOpen || !val.tab) {
            log.info({'Refusing to re-mark already-closed tab as closed':val});
            return false;
        }

        D.tabs.change_key(val, 'tab_id', K.NONE);
        // node_id is unchanged
        val.win_id = K.NONE;
        val.index = K.NONE;
        val.tab = undefined;
        // being_opened unchanged
        // raw_url unchanged
        // raw_title unchanged
        val.isOpen = false;
        // raw_bullet unchanged
        // raw_favicon_url unchanged

        T.treeobj.del_multitype(node_id, K.NST_OPEN);

        module.refresh_label(node_id);  // TODO is this necessary?
        // Don't change icon - keep favicon

        return true;
    } //markTabAsClosed

    // }}}1
    // Removing model items //////////////////////////////////////////// {{{1

    /// Delete a tab from the tree and the details.
    /// ** NOTE ** Does NOT update the parent's val.ordered_url_hash.
    /// TODO? Report error if tab is currently open?
    /// @param tab_vorny {mixed}
    /// @return {Boolean} true on success; false on error
    module.eraseTab = function(tab_vorny) {
        let {val, node_id} = module.vn_by_vorny(tab_vorny, K.IT_TAB);
        let node = T.treeobj.get_node(node_id);
        if(!val || !node_id || !node) return false;

        let parent_node_id = node.parent;

        D.tabs.remove_value(val);
            // So any events that are triggered won't try to look for a
            // nonexistent tab.
        T.treeobj.delete_node(node_id);

        return true;
    } //eraseTab

    /// Delete a window from the tree and the details.  This will also
    /// erase any remaining child nodes of #win_vorny from the
    /// tree and the details.  On an error return, not all children may
    /// have been destroyed.
    /// TODO? Report error if win is currently open?
    /// TODO? Report error if any children are left?
    /// @param win_vorny {mixed}  The item
    /// @return {Boolean} true on success; false on error
    module.eraseWin = function(win_vorny) {
        let {val, node_id} = module.vn_by_vorny(win_vorny, K.IT_WIN);
        if(!val || !node_id) return false;

        let node = T.treeobj.get_node(node_id);
        if(!node) return false;

        // Remove the children cleanly
        for(let child_node_id of node.children) {
            if(!module.eraseTab(child_node_id)) {
                return false;
            }
        }

        D.windows.remove_value(val);
            // So any events that are triggered won't try to look for a
            // nonexistent window.
        T.treeobj.delete_node(node_id);

        return true;
    } //eraseWin

    // }}}1

    return module;
}));

// vi: set ts=4 sts=4 sw=4 et ai fo-=ro foldmethod=marker: //
