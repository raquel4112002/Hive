import { Trans, useLingui } from "@lingui/react/macro";
import type { BotAvatarSet } from "@rakazo/contracts";
import { BOT_NAME_MAX_LENGTH, DEFAULT_NEW_BOT_AVATAR_SET } from "@rakazo/contracts";
import {
  newClientId,
  ORGANIC_AVATAR_HEART_FAMILY,
  ORGANIC_AVATAR_LOOKS,
  organicAvatarFamily,
  organicAvatarSampleIdentity,
} from "@rakazo/core";
import {
  BOT_AVATAR_COLORS,
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  parseBotAvatar,
} from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { errorText } from "../../lib/user-error";
import { BotLookPicker } from "./avatar-studio-popover";

/** One preview identity per organic look, so the dialog can show a body before the bot has an id. */
const ORGANIC_IDENTITIES = ORGANIC_AVATAR_LOOKS.map(organicAvatarSampleIdentity);

function pick<T>(options: readonly T[]): T {
  return options[Math.floor(Math.random() * options.length)]!;
}

export interface CreateBotDialogInput {
  name: string;
  color: string;
  /** Reserve the logo preview's persistent seed through creation and retries. */
  id?: string;
  avatarSet: BotAvatarSet;
  /** The organic family the preview drew; omitted when a studio shape is picked. */
  avatarFamily?: number;
  model?: string;
  monthlyBudget?: number;
  modelKey?: string;
}

/** Mounted only while open; the parent unmounts it from `onCancel` or after `onCreate`. */
export function CreateBotDialog({
  onCancel,
  onCreate,
  loadModels,
}: {
  onCancel: () => void;
  onCreate: (input: CreateBotDialogInput) => Promise<void>;
  loadModels?: () => Promise<{ enabled: boolean; models: string[] }>;
}) {
  const { t } = useLingui();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [previewId] = useState(() => {
    let id: string;
    do {
      id = `c${newClientId().replaceAll("-", "").slice(0, 24)}`;
    } while (organicAvatarFamily(id) === ORGANIC_AVATAR_HEART_FAMILY);
    return id;
  });
  const [look, setLook] = useState(() => ({
    value: pick(BOT_AVATAR_COLORS),
    identity: pick(ORGANIC_IDENTITIES),
  }));
  const [avatarSet, setAvatarSet] = useState<BotAvatarSet>(DEFAULT_NEW_BOT_AVATAR_SET);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [budget, setBudget] = useState("");
  const [modelKey, setModelKey] = useState("");
  const trimmed = name.trim();

  const loadModelsRef = useRef(loadModels);
  loadModelsRef.current = loadModels;
  useEffect(() => {
    const load = loadModelsRef.current;
    if (!load) return;
    let live = true;
    load()
      .then((catalog) => {
        if (!live || !catalog.enabled) return;
        setModels(catalog.models);
        setModel(catalog.models[0] ?? "");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function create() {
    if (!trimmed || submitting) return;
    setError(null);
    setSubmitting(true);
    const organic = avatarSet === "organic" && parseBotAvatar(look.value).shapeIndex === undefined;
    try {
      const monthlyBudget = budget.trim() ? Number(budget) : undefined;
      await onCreate({
        name: trimmed,
        color: look.value,
        ...(avatarSet === "rakazo" ? { id: previewId } : {}),
        avatarSet,
        ...(organic ? { avatarFamily: organicAvatarFamily(look.identity) } : {}),
        ...(model ? { model } : {}),
        ...(monthlyBudget && monthlyBudget > 0 ? { monthlyBudget } : {}),
        ...(modelKey.trim() ? { modelKey: modelKey.trim() } : {}),
      });
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={nameRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        data-testid="create-bot-dialog"
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              <Trans>New bot</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <BotAvatar
              color={look.value}
              identity={avatarSet === "rakazo" ? previewId : look.identity}
              size={96}
              avatarSet={avatarSet}
            />
          </div>
          <Input
            ref={nameRef}
            aria-label={t`Name`}
            placeholder={t`Name your Bot`}
            value={name}
            maxLength={BOT_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            className="text-center"
          />
          {error ? (
            <p role="alert" data-testid="create-bot-error" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          {models.length > 0 ? (
            <div className="grid gap-2">
              <label className="grid gap-1 text-sm">
                <Trans>Model</Trans>
                <select
                  aria-label={t`Model`}
                  className="h-9 rounded-md border border-border bg-background px-2"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {models.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                aria-label="Monthly budget"
                placeholder="Monthly budget"
                inputMode="decimal"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
              <Input
                aria-label="Existing key"
                placeholder="Existing key"
                type="password"
                autoComplete="off"
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value)}
              />
            </div>
          ) : null}
          <BotLookPicker
            value={look.value}
            identity={avatarSet === "rakazo" ? previewId : look.identity}
            organicIdentities={ORGANIC_IDENTITIES}
            avatarSet={avatarSet}
            onAvatarSetChange={(set, value) => {
              setAvatarSet(set);
              setLook((current) => ({ ...current, value }));
            }}
            onChange={(value, identity) => {
              setLook((current) => ({ value, identity: identity ?? current.identity }));
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!trimmed || submitting}>
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
