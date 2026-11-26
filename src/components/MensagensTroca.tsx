import { Textarea } from "@/components/ui/textarea";

/** Limite de caracteres das mensagens de troca (mesmo valor do banco: check de 300). */
export const TROCA_MSG_MAX = 300;

export type RespostaTroca = {
  team: string;
  accepted: boolean | null;
  mensagem: string | null;
};

/** Caixa de texto (com contador) usada ao propor, aceitar, recusar ou contra-propor. */
export function MensagemTrocaBox({
  value,
  onChange,
  label,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  id?: string;
}) {
  return (
    <div className="space-y-1 text-left">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
      )}
      <Textarea
        id={id}
        value={value}
        maxLength={TROCA_MSG_MAX}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <p className="text-right text-[11px] text-muted-foreground">
        {value.length}/{TROCA_MSG_MAX}
      </p>
    </div>
  );
}

/** Mensagem do proponente e as respostas (aceite/recusa) dos outros times, quando houver. */
export function MensagensTroca({
  proposerTeam,
  mensagem,
  respostas,
}: {
  proposerTeam?: string | null;
  mensagem: string | null;
  respostas: RespostaTroca[];
}) {
  const respComTexto = respostas.filter((r) => r.mensagem);
  if (!mensagem && respComTexto.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
      {mensagem && (
        <p>
          <span className="font-semibold">{proposerTeam ?? "Proponente"}:</span>{" "}
          <span className="whitespace-pre-line">{mensagem}</span>
        </p>
      )}
      {respComTexto.map((r, i) => (
        <p key={i}>
          <span className="font-semibold">
            {r.team}
            {r.accepted === true ? " (aceitou)" : r.accepted === false ? " (recusou)" : ""}:
          </span>{" "}
          <span className="whitespace-pre-line">{r.mensagem}</span>
        </p>
      ))}
    </div>
  );
}
