import { SYSTEM, SETTINGS } from '../settings.js';

export class CombatHUD extends Application {
    constructor(options) {
        super(options);

        Hooks.callAll('combatHudInit', this);
        Hooks.on("createCombatant", this._onUpdateHUD.bind(this));
        Hooks.on("deleteCombatant", this._onUpdateHUD.bind(this));

        Hooks.on("updateActor", this._onUpdateHUD.bind(this));
        Hooks.on("updateToken", this._onUpdateHUD.bind(this));

        Hooks.on("updateItem", this._onUpdateHUD.bind(this));
        Hooks.on("createItem", this._onUpdateHUD.bind(this));
        Hooks.on("deleteItem", this._onUpdateHUD.bind(this));

        Hooks.on("createActiveEffect", this._onUpdateHUD.bind(this));
        Hooks.on("updateActiveEffect", this._onUpdateHUD.bind(this));
        Hooks.on("deleteActiveEffect", this._onUpdateHUD.bind(this));

        Hooks.on("deleteCombat", this.close.bind(this));
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'combat-hud',
            template: 'systems/projectfu/templates/ui/combat-hud.hbs',
            popOut: false,
            classes: [...super.defaultOptions.classes, 'projectfu'],
        });
    }

    _getAdditionalStyle(opacity) {
        return "--hud-opacity: " + opacity + ";" +
                "--hud-background-gradient: linear-gradient(to bottom, rgba(44, 88, 77, var(--hud-opacity)), rgba(160, 205, 188, var(--hud-opacity))), rgba(43, 74, 66, var(--hud-opacity));" +
                "--hud-boxshadow-color: rgba(43, 74, 66, var(--hud-opacity));"
    }

    async getData(options = {}) {
		const data = await super.getData(options);
		data.cssClasses = this.options.classes.join(' ');
        data.cssId = this.options.id;
        data.isCompact = game.settings.get(SYSTEM, SETTINGS.optionCombatHudCompact);
        
        const opacity = game.settings.get(SYSTEM, SETTINGS.optionCombatHudOpacity) / 100;
        data.additionalStyle = this._getAdditionalStyle(opacity);

        data.npcs = [];
        data.characters = [];

        if (!game.combat) return data;

        for (const combatant of game.combat.combatants) {
            if (!combatant.actor || !combatant.token) continue;
            
            const actorData = {
                actor: combatant.actor,
                token: combatant.token,
                effects: game.release.generation >= 11 ? Array.from(combatant.actor.allApplicableEffects()) : combatant.actor.effects,
                img: game.settings.get(SYSTEM, SETTINGS.optionCombatHudPortrait) === 'token' ? combatant.token.texture.src : combatant.actor.img,
            };

            if (combatant.token.disposition === foundry.CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
                data.characters.push(actorData);
            }
            else {
                data.npcs.push(actorData);
            }
        }
        
		return data;
	}

    activateListeners(html) {
        super.activateListeners(html);

        const rows = html.find('.combat-row');
        rows.hover(this._onHoverIn.bind(this), this._onHoverOut.bind(this));

        const combatantImages = html.find('.combat-row .token-image');
        combatantImages.click((event) => this._onCombatantClick(event));
        
        const popOutButton = html.find('.window-popout');
        popOutButton.click(this._doPopOut.bind(this));

        const compactButton = html.find('.window-compact');
        compactButton.click(this._doToggleCompact.bind(this));

        const minimizeButton = html.find('.window-minimize');
        minimizeButton.click(this._doMinimize.bind(this));
    }

    _doMinimize() {
        game.settings.set(SYSTEM, SETTINGS.optionCombatHudMinimized, true);
    
        const tokenButton = ui.controls.controls.find((control) => control.name === 'token');
        if (tokenButton) {
            tokenButton.tools.find((tool) => tool.name === 'projectfu-combathud-toggle').active = false;
            ui.controls.render(true);
        }

        CombatHUD.close();
    }

    _doToggleCompact() {
        const isCompact = !game.settings.get(SYSTEM, SETTINGS.optionCombatHudCompact);
        game.settings.set(SYSTEM, SETTINGS.optionCombatHudCompact, isCompact);

        const icons = this.element.find('.window-compact .fas');
        icons.toggleClass("hidden");

        this.element.find('.faction-list').toggleClass("compact");
    }

    _doPopOut() {
        if (!PopoutModule || !PopoutModule.singleton) return;

        ui.windows[this.appId] = this;
        this._poppedOut = true;
        this.element.find('.window-popout').css("display", "none");
        this.element.find('.window-compact').css("display", "none");
        this.element.find('.window-minimize').css("display", "none");
        PopoutModule.singleton.onPopoutClicked(this);
    }

    _onCombatantClick(event) {
        event.preventDefault();

        const now = Date.now();
        const dt = now - this._clickTime;
        this._clickTime = now;
        if (dt <= 250) {
            this._onCombatantDoubleClick(event);
            return;
        }

        const isShiftActive = game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.SHIFT);
        
        const combatRow = event.currentTarget.closest('.combat-row');
        const token = canvas.tokens.get(combatRow.dataset.tokenId);
        if (token) {
            if (!token.actor?.testUserPermission(game.user, 'OBSERVER')) {
                return;
            }

            token.control({ releaseOthers: !isShiftActive });
        }
    }

    _onCombatantDoubleClick(event) {
        event.preventDefault();

        const combatRow = event.currentTarget.closest('.combat-row');
        const token = canvas.tokens.get(combatRow.dataset.tokenId);
        
        if (token) {
            const combatant = game.combat.combatants.find(c => c.tokenId === token.id);
            if (combatant.token.disposition === foundry.CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
                this._onCharacterDoubleClick(token);
            } else {
                this._onNPCDoubleClick(token);
            }
        }
    }

    _onCharacterDoubleClick(token) {
        if (!token) return;
        if (!token.actor?.testUserPermission(game.user, 'OBSERVER') && !game.user.isGM) return;
        
        token.actor?.sheet.render(true);
    }

    _onNPCDoubleClick(token) {
        if (!token) return;

        if (game.user.isGM) {
            const actorSheet = token.actor.sheet;
            if (actorSheet) {
                actorSheet.render(true);
            }
        } else {
            const studyJournal = game.journal.getName(token.actor?.name);
            if (studyJournal) {
                studyJournal.sheet.render(true);
            }
        }
    }

    async _render(force, options) {
        if (game.settings.get(SYSTEM, SETTINGS.optionCombatHudMinimized)) {
            this.close();
            return;
        }

        await super._render(force, options);
        if (this._poppedOut) { 
            this.element.css("width", "calc(100% - 4px)");
            this.element.css("height", "100%");
            this.element.css("left", "0px");  
            return;
        }

        const hOffset = -5;
        const minWidth = 700;

        const uiMiddle = $("#ui-middle");
        const hudWidth = minWidth + (uiMiddle.width() - minWidth) * (game.settings.get(SYSTEM, SETTINGS.optionCombatHudWidth) / 100);
        this.element.css("width", hudWidth + hOffset);

        this.element.css("left", uiMiddle.position().left);

        if (game.settings.get(SYSTEM, SETTINGS.optionCombatHudPosition) === 'top') {
            const uiTop = $("#ui-top");
            this.element.css("top", uiTop.height() + 2);
        } else {
            const uiBottom = $("#ui-bottom");
            this.element.css("bottom", uiBottom.height() + 10);
        }
    }

    _onUpdateHUD() {
        this.render(true);
    }

    _onHoverIn(event) {
        event.preventDefault();
        if (!canvas.ready) return;

        const combatRow = event.currentTarget;
        const token = canvas.tokens.get(combatRow.dataset.tokenId);
        if (token && token.isVisible) {
            if (!token.controlled) 
                token._onHoverIn(event, {hoverOutOthers: true});

            this._hoveredToken = token;
        }
    }

    _onHoverOut(event) {
        event.preventDefault();
        if (!canvas.ready) return;

        if (this._hoveredToken) {
            this._hoveredToken._onHoverOut(event);
        }

        this._hoveredToken = null;
    }

    close() {
        if (this._poppedOut) {
            this._poppedOut = false;
            this.element.find('.window-popout').css("display", "block");
            this.element.find('.window-compact').css("display", "block");
            this.element.find('.window-minimize').css("display", "block");
            return;
        }
        super.close();
    }

    static init() {
        ui.combatHud = new CombatHUD();
        ui.combatHud.render(true);
    }

    static close() {
        if (ui.combatHud) {
            ui.combatHud.close();
        }

        ui.combatHud = null;
    }

    static minimize() {
        if (ui.combatHud) {
            ui.combatHud._doMinimize();
        }

        ui.combatHud = null;
    }

    static restore() {
        game.settings.set(SYSTEM, SETTINGS.optionCombatHudMinimized, false);

        if (game.combat && game.combat.isActive)
            CombatHUD.init();
    }

    static getToggleControlButton() {
        const isMinimized = game.settings.get(SYSTEM, SETTINGS.optionCombatHudMinimized);
        return {
            name: 'projectfu-combathud-toggle',
            title: game.i18n.localize('FU.CombatHudControlButtonTitle'),
            icon: 'fas fa-thumbtack',
            button: false,
            toggle: true,
            active: !isMinimized,
            onClick: () => {
                if (isMinimized) {
                    CombatHUD.restore();
                } else {
                    CombatHUD.minimize();
                }
            },
        };  
    }
}