import {
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./SettingsSelect.css";

/**
 * Drop-in custom replacement for native `<select>` controls.
 *
 * It accepts the same `<option>` children and emits an event-shaped object
 * (`{ target: { value } }`) so existing `e.target.value` handlers keep
 * working unchanged, while the popup menu is fully custom-rendered instead
 * of the unstylable OS-native listbox.
 */

interface SettingsSelectChangeEvent {
  target: { value: string };
}

interface SettingsSelectProps {
  value: string;
  onChange?: (event: SettingsSelectChangeEvent) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
  "aria-label"?: string;
  children?: ReactNode;
}

interface ParsedOption {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

function parseOptions(children: ReactNode): ParsedOption[] {
  const result: ParsedOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "optgroup") {
      const groupProps = child.props as { children?: ReactNode };
      result.push(...parseOptions(groupProps.children));
      return;
    }
    if (child.type !== "option") return;
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    };
    result.push({
      value: props.value !== undefined ? String(props.value) : "",
      label: props.children,
      disabled: Boolean(props.disabled),
    });
  });
  return result;
}

const MENU_MAX_HEIGHT = 320;
const MENU_GAP = 6;

export function SettingsSelect({
  value,
  onChange,
  disabled = false,
  className,
  style,
  id,
  "aria-label": ariaLabel,
  children,
}: SettingsSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo(() => parseOptions(children), [children]);
  const selected = options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = (event?: Event) => {
      const eventTarget = event?.target;
      if (
        event?.type === "scroll" &&
        eventTarget instanceof Node &&
        menuRef.current?.contains(eventTarget)
      ) {
        return;
      }
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 148);
      const left = Math.min(rect.right - width, Math.max(8, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - rect.bottom - 16;
      const spaceAbove = rect.top - 16;
      const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const nextStyle = openUp
        ? {
            bottom: Math.round(window.innerHeight - rect.top + MENU_GAP),
            left: Math.round(left),
            width: Math.round(width),
            maxHeight: Math.round(Math.min(MENU_MAX_HEIGHT, Math.max(140, spaceAbove))),
          }
        : {
            top: Math.round(rect.bottom + MENU_GAP),
            left: Math.round(left),
            width: Math.round(width),
            maxHeight: Math.round(Math.min(MENU_MAX_HEIGHT, Math.max(140, spaceBelow))),
          };
      setMenuStyle((prev) =>
        prev &&
        prev.top === nextStyle.top &&
        prev.bottom === nextStyle.bottom &&
        prev.left === nextStyle.left &&
        prev.width === nextStyle.width &&
        prev.maxHeight === nextStyle.maxHeight
          ? prev
          : nextStyle,
      );
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(
            ".settings-select-option:not(:disabled)",
          ) ?? [],
        );
        if (items.length === 0) return;
        const activeIndex = items.findIndex(
          (item) => item === document.activeElement,
        );
        const nextIndex =
          event.key === "ArrowDown"
            ? Math.min(items.length - 1, activeIndex + 1)
            : Math.max(0, activeIndex <= 0 ? 0 : activeIndex - 1);
        items[nextIndex]?.focus();
      }
    };

    updateMenuPosition();
    // Defer binding so the opening click doesn't immediately close the menu.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handlePointerDown);
    }, 0);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !menuStyle) return;
    const active = menuRef.current?.querySelector<HTMLButtonElement>(
      ".settings-select-option.active",
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [open, menuStyle]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const triggerClassName = [
    "settings-select-trigger",
    open ? "open" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={triggerClassName}
        style={style}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        <span className="settings-select-trigger-label">
          {selected ? selected.label : ""}
        </span>
        <ChevronDown size={14} className="settings-select-trigger-arrow" aria-hidden />
      </button>
      {open && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="settings-select-menu"
              role="listbox"
              aria-label={ariaLabel}
              style={{
                position: "fixed",
                top: menuStyle.top !== undefined ? `${menuStyle.top}px` : "auto",
                bottom:
                  menuStyle.bottom !== undefined ? `${menuStyle.bottom}px` : "auto",
                left: `${menuStyle.left}px`,
                minWidth: `${menuStyle.width}px`,
                maxHeight: `${menuStyle.maxHeight}px`,
                zIndex: 15000,
              }}
            >
              {options.map((option, index) => {
                const active = option.value === value;
                return (
                  <button
                    key={`${option.value}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={option.disabled}
                    className={`settings-select-option${active ? " active" : ""}`}
                    onClick={() => {
                      if (option.disabled) return;
                      setOpen(false);
                      if (option.value !== value) {
                        onChange?.({ target: { value: option.value } });
                      }
                    }}
                  >
                    <span className="settings-select-option-label">
                      {option.label}
                    </span>
                    <span className="settings-select-option-check">
                      {active ? <Check size={14} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
