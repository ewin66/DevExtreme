import $ from "../../core/renderer";
import eventsEngine from "../../events/core/events_engine";
import { extend } from "../../core/utils/extend";
import typeUtils from "../../core/utils/type";
import { when, Deferred } from "../../core/utils/deferred";

import registerComponent from "../../core/component_registrator";
import Widget from "../widget/ui.widget";
import notify from "../notify";

import FileItemsController from "./file_items_controller";
import { FileManagerCommandManager } from "./ui.file_manager.command_manager";
import FileManagerContextMenu from "./ui.file_manager.context_menu";
import FileManagerFilesTreeView from "./ui.file_manager.files_tree_view";
import FileManagerDetailsItemList from "./ui.file_manager.item_list.details";
import FileManagerThumbnailsItemList from "./ui.file_manager.item_list.thumbnails";
import FileManagerToolbar from "./ui.file_manager.toolbar";
import FileManagerEditingControl from "./ui.file_manager.editing";
import FileManagerBreadcrumbs from "./ui.file_manager.breadcrumbs";
import FileManagerAdaptivityControl from "./ui.file_manager.adaptivity";
import { getName, getParentPath } from "./ui.file_manager.utils";

import { FileManagerItem } from "./file_provider/file_provider";

const FILE_MANAGER_CLASS = "dx-filemanager";
const FILE_MANAGER_CONTAINER_CLASS = FILE_MANAGER_CLASS + "-container";
const FILE_MANAGER_DIRS_PANEL_CLASS = FILE_MANAGER_CLASS + "-dirs-panel";
const FILE_MANAGER_INACTIVE_AREA_CLASS = FILE_MANAGER_CLASS + "-inactive-area";
const FILE_MANAGER_EDITING_CONTAINER_CLASS = FILE_MANAGER_CLASS + "-editing-container";
const FILE_MANAGER_ITEMS_PANEL_CLASS = FILE_MANAGER_CLASS + "-items-panel";
const FILE_MANAGER_ITEM_CUSTOM_THUMBNAIL_CLASS = FILE_MANAGER_CLASS + "-item-custom-thumbnail";

class FileManager extends Widget {

    _initTemplates() {
    }

    _initMarkup() {
        super._initMarkup();

        this._onSelectedFileOpenedAction = this._createActionByOption("onSelectedFileOpened");

        this._controller = new FileItemsController({
            rootText: "",
            fileProvider: this.option("fileProvider"),
            onSelectedDirectoryChanged: this._onSelectedDirectoryChanged.bind(this)
        });
        this._commandManager = new FileManagerCommandManager(this.option("permissions"));

        this.$element().addClass(FILE_MANAGER_CLASS);

        const $toolbar = $("<div>").appendTo(this.$element());
        this._toolbar = this._createComponent($toolbar, FileManagerToolbar, {
            commandManager: this._commandManager,
            itemViewMode: this.option("itemView").mode
        });

        this._createAdaptivityControl();
        this._createEditing();

        this._initCommandManager();
        this._setItemsViewAreaActive(false);
    }

    _createAdaptivityControl() {
        const $container = $("<div>")
            .addClass(FILE_MANAGER_CONTAINER_CLASS)
            .appendTo(this.$element());

        this._adaptivityControl = this._createComponent($container, FileManagerAdaptivityControl, {
            drawerTemplate: container => this._createFilesTreeView(container),
            contentTemplate: container => this._createItemsPanel(container),
            onAdaptiveStateChanged: e => this._onAdaptiveStateChanged(e)
        });
    }

    _createEditing() {
        const $editingContainer = $("<div>")
            .addClass(FILE_MANAGER_EDITING_CONTAINER_CLASS)
            .appendTo(this.$element());

        this._editing = this._createComponent($editingContainer, FileManagerEditingControl, {
            controller: this._controller,
            model: {
                getMultipleSelectedItems: this._getMultipleSelectedItems.bind(this)
            },
            onSuccess: ({ message, updatedOnlyFiles }) => {
                this._showSuccess(message);
                this._redrawComponent(updatedOnlyFiles);
            },
            onError: ({ message }) => this._showError(message),
            onCreating: () => this._setItemsViewAreaActive(false)
        });
    }

    _createItemsPanel($container) {
        this._$itemsPanel = $("<div>")
            .addClass(FILE_MANAGER_ITEMS_PANEL_CLASS)
            .appendTo($container);

        this._createBreadcrumbs(this._$itemsPanel);
        this._createItemView(this._$itemsPanel);
    }

    _createFilesTreeView(container) {
        const $filesTreeView = $("<div>")
            .addClass(FILE_MANAGER_DIRS_PANEL_CLASS)
            .appendTo(container);

        this._filesTreeView = this._createComponent($filesTreeView, FileManagerFilesTreeView, {
            storeExpandedState: true,
            contextMenu: this._createContextMenu(),
            getDirectories: this.getDirectories.bind(this),
            getCurrentDirectory: this._getCurrentDirectory.bind(this),
            onDirectoryClick: this._onFilesTreeViewDirectoryClick.bind(this)
        });
    }

    _createItemView($container, viewMode) {
        const itemViewOptions = this.option("itemView");

        const options = {
            selectionMode: this.option("selectionMode"),
            contextMenu: this._createContextMenu(),
            getItems: this._getItemViewItems.bind(this),
            onError: ({ error }) => this._showError(error),
            onSelectionChanged: this._onItemViewSelectionChanged.bind(this),
            onSelectedItemOpened: this._onSelectedItemOpened.bind(this),
            onSelectedFileOpened: this._createActionByOption("onSelectedFileOpened"),
            getItemThumbnail: this._getItemThumbnailInfo.bind(this),
            customizeDetailColumns: this.option("customizeDetailColumns")
        };

        const $itemView = $("<div>").appendTo($container);

        viewMode = viewMode || itemViewOptions.mode;
        const widgetClass = viewMode === "thumbnails" ? FileManagerThumbnailsItemList : FileManagerDetailsItemList;
        this._itemView = this._createComponent($itemView, widgetClass, options);

        eventsEngine.on($itemView, "click", this._onItemViewClick.bind(this));
    }

    _createBreadcrumbs($container) {
        const $breadcrumbs = $("<div>").appendTo($container);
        this._breadcrumbs = this._createComponent($breadcrumbs, FileManagerBreadcrumbs, {
            path: "",
            onPathChanged: e => this.setCurrentFolderPath(e.newPath),
            onOutsideClick: () => this._clearSelection()
        });
    }

    _createContextMenu() {
        const $contextMenu = $("<div>").appendTo(this.$element());
        return this._createComponent($contextMenu, FileManagerContextMenu, {
            commandManager: this._commandManager
        });
    }

    _initCommandManager() {
        const actions = extend(this._editing.getCommandActions(), {
            refresh: () => this._redrawComponent(),
            thumbnails: () => this._switchView("thumbnails"),
            details: () => this._switchView("details"),
            clear: () => this._clearSelection(),
            showDirsPanel: () => this._adaptivityControl.toggleDrawer()
        });
        this._commandManager.registerActions(actions);
    }

    _onFilesTreeViewDirectoryClick({ itemData }) {
        this._setCurrentDirectory(itemData);
        this._setItemsViewAreaActive(false);
    }

    _onItemViewSelectionChanged() {
        this._updateToolbar();
    }

    _onAdaptiveStateChanged({ enabled }) {
        this._commandManager.setCommandEnabled("showDirsPanel", enabled);
        this._updateToolbar();
    }

    _updateToolbar() {
        const items = this.getSelectedItems();
        this._toolbar.update(items);
    }

    _setItemsViewAreaActive(active) {
        if(this._itemsViewAreaActive === active) {
            return;
        }

        this._itemsViewAreaActive = active;

        let $activeArea = null;
        let $inactiveArea = null;
        if(active) {
            $activeArea = this._itemView.$element();
            $inactiveArea = this._filesTreeView.$element();
        } else {
            $activeArea = this._filesTreeView.$element();
            $inactiveArea = this._itemView.$element();
        }

        $activeArea.removeClass(FILE_MANAGER_INACTIVE_AREA_CLASS);
        $inactiveArea.addClass(FILE_MANAGER_INACTIVE_AREA_CLASS);

        if(!active) {
            this._clearSelection();
        }
    }

    _switchView(viewMode) {
        this._disposeWidget(this._itemView.option("contextMenu"));
        this._disposeWidget(this._itemView);

        this._createItemView(this._$itemsPanel, viewMode);
    }

    _disposeWidget(widget) {
        widget.dispose();
        widget.$element().remove();
    }

    _clearSelection() {
        this._itemView.clearSelection();
    }

    _getMultipleSelectedItems() {
        return this._itemsViewAreaActive ? this.getSelectedItems() : [ this._getCurrentDirectory() ];
    }

    _showSuccess(message) {
        this._showNotification(message, true);
    }

    _showError(message) {
        this._showNotification(message, false);
    }

    _showNotification(message, isSuccess) {
        notify({
            message: message,
            width: 450
        }, isSuccess ? "success" : "error", 5000);
    }

    _redrawComponent(onlyFileItemsView) {
        !onlyFileItemsView && this._filesTreeView.refresh();
        this._itemView.refresh();
    }

    _getItemViewItems() {
        const selectedDir = this._getCurrentDirectory();
        if(!selectedDir) {
            return new Deferred()
                .resolve([])
                .promise();
        }

        let itemInfos = this.option("itemView").showFolders
            ? this._controller.getDirectoryContents(selectedDir)
            : this._controller.getFiles(selectedDir);

        if(this.option("itemView.showParentFolder") && !selectedDir.fileItem.isRoot) {
            let parentDirItem = new FileManagerItem(selectedDir.fileItem, "..", true);
            parentDirItem.isParentFolder = true;
            itemInfos = when(itemInfos)
                .then(items => {
                    let itemInfosCopy = [...items];
                    itemInfosCopy.unshift({
                        fileItem: parentDirItem,
                        icon: "folder"
                    });
                    return itemInfosCopy;
                });
        }

        return itemInfos;
    }

    _onItemViewClick() {
        this._setItemsViewAreaActive(true);
    }

    _getItemThumbnailInfo(fileInfo) {
        const func = this.option("customizeThumbnail");
        const thumbnail = typeUtils.isFunction(func) ? func(fileInfo.fileItem) : fileInfo.fileItem.thumbnail;
        if(thumbnail) {
            return {
                thumbnail,
                cssClass: FILE_MANAGER_ITEM_CUSTOM_THUMBNAIL_CLASS
            };
        }
        return {
            thumbnail: fileInfo.icon
        };
    }

    _createFolderItemByPath(path) {
        const parentPath = getParentPath(path);
        const name = getName(path);
        return new FileManagerItem(parentPath, name, true);
    }

    _getDefaultOptions() {
        return extend(super._getDefaultOptions(), {
            /**
            * @name dxFileManagerOptions.fileProvider
            * @type object
            * @default null
            */
            fileProvider: null,

            /**
            * @name dxFileManagerOptions.selectionMode
            * @type Enums.FileManagerSelectionMode
            * @default "multiple"
            */
            selectionMode: "multiple", // "single"

            /**
            * @name dxFileManagerOptions.itemView
            * @type object
            * @default null
            */
            itemView: {
                /**
                * @name dxFileManagerOptions.itemView.mode
                * @type Enums.FileManagerItemViewMode
                * @default "details"
                */
                mode: "details", // "thumbnails"
                /**
                * @name dxFileManagerOptions.itemView.showFolders
                * @type boolean
                * @default true
                */
                showFolders: true,
                /**
                * @name dxFileManagerOptions.itemView.showParentFolder
                * @type boolean
                * @default true
                */
                showParentFolder: true
            },

            /**
            * @name dxFileManagerOptions.customizeThumbnail
            * @type function
            * @type_function_param1 fileItem:object
            * @type_function_return string
            */
            customizeThumbnail: null,

            /**
            * @name dxFileManagerOptions.customizeDetailColumns
            * @type function
            * @type_function_param1 columns:Array<dxDataGridColumn>
            * @type_function_return Array<dxDataGridColumn>
            */
            customizeDetailColumns: null,

            /**
            * @name dxFileManagerOptions.onSelectedFileOpened
            * @extends Action
            * @type function(e)
            * @type_function_param1 e:object
            * @type_function_param1_field4 fileItem:object
            * @default null
            * @action
            */
            onSelectedFileOpened: null,

            /**
             * @name dxFileManagerOptions.permissions
             * @type object
             */
            permissions: {
                /**
                 * @name dxFileManagerOptions.permissions.create
                 * @type boolean
                 * @default false
                 */
                create: false,
                /**
                 * @name dxFileManagerOptions.permissions.copy
                 * @type boolean
                 * @default false
                 */
                copy: false,
                /**
                 * @name dxFileManagerOptions.permissions.move
                 * @type boolean
                 * @default false
                 */
                move: false,
                /**
                 * @name dxFileManagerOptions.permissions.remove
                 * @type boolean
                 * @default false
                 */
                remove: false,
                /**
                 * @name dxFileManagerOptions.permissions.rename
                 * @type boolean
                 * @default false
                 */
                rename: false,
                /**
                 * @name dxFileManagerOptions.permissions.upload
                 * @type boolean
                 * @default false
                 */
                upload: false
            }
        });
    }

    _optionChanged(args) {
        const name = args.name;

        switch(name) {
            case "fileProvider":
            case "selectionMode":
            case "itemView":
            case "customizeThumbnail":
            case "customizeDetailColumns":
            case "permissions":
                this.repaint();
                break;
            case "onSelectedFileOpened":
                this._onSelectedFileOpenedAction = this._createActionByOption("onSelectedFileOpened");
                break;
            default:
                super._optionChanged(args);
        }
    }

    executeCommand(commandName) {
        this._commandManager.executeCommand(commandName);
    }

    setCurrentFolderPath(path) {
        const folder = this._createFolderItemByPath(path);
        this.setCurrentFolder(folder);
    }

    getCurrentFolderPath() {
        return this.getCurrentFolder() ? this.getCurrentFolder().relativeName : null;
    }

    _setCurrentDirectory(directoryInfo) {
        this._controller.setCurrentDirectory(directoryInfo);
    }

    _getCurrentDirectory() {
        return this._controller.getCurrentDirectory();
    }

    _onSelectedDirectoryChanged() {
        this._filesTreeView.updateCurrentDirectory();
        this._itemView.refresh();
        this._breadcrumbs.option("path", this._controller.getCurrentPath());
    }

    getDirectories(parentDirectoryInfo) {
        return this._controller.getDirectories(parentDirectoryInfo);
    }

    getSelectedItems() {
        return this._itemView.getSelectedItems();
    }

    _onSelectedItemOpened({ fileItemInfo }) {
        const fileItem = fileItemInfo.fileItem;
        if(!fileItem.isDirectory) {
            this._onSelectedFileOpenedAction({ fileItem });
            return;
        }

        const newCurrentDirectory = fileItem.isParentFolder ? this._getCurrentDirectory().parentDirectory : fileItemInfo;
        this._setCurrentDirectory(newCurrentDirectory);

        if(newCurrentDirectory) {
            this._filesTreeView.expandDirectory(newCurrentDirectory.parentDirectory);
        }
    }

}

registerComponent("dxFileManager", FileManager);

module.exports = FileManager;