export type DropdownOption = {
    /** Text content of the option (optional for divider type) */
    label?: string;
    
    /** Type of row to render. Defaults to 'item'. */
    type?: "item" | "divider" | "header";
    
    /** Optional Google Material Symbols rounded icon name */
    icon?: string | null;
    
    /** 
     * Optional styling color: can be a CSS color value (e.g. '#ff0000', 'rgb(...)')
     * or a Tailwind CSS text color class (e.g. 'text-error', 'text-destructive')
     */
    color?: string;
    
    /** Callback click handler */
    onclick?: (event: MouseEvent | KeyboardEvent) => void;
    
    /** Optional nested options for multi-level menus */
    submenu?: DropdownOption[];
    
    /** Whether the option is disabled */
    disabled?: boolean;
};
