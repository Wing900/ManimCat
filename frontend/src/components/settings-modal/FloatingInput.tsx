interface FloatingInputProps {
  id: string;
  label: string;
  type: 'text' | 'password';
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  containerClassName?: string;
  labelClassName?: string;
  inputClassName?: string;
}

export function FloatingInput({
  id,
  label,
  type,
  value,
  placeholder,
  onChange,
  suggestions,
  containerClassName = '',
  labelClassName = '',
  inputClassName = '',
}: FloatingInputProps) {
  const datalistId = suggestions && suggestions.length > 0 ? `${id}__datalist` : undefined;

  return (
    <div className={`relative ${containerClassName}`.trim()}>
      <label
        htmlFor={id}
        className={`absolute left-4 -top-2.5 px-2 bg-bg-secondary text-xs font-medium text-text-secondary transition-all ${labelClassName}`.trim()}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        list={datalistId}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-4 py-4 bg-bg-secondary/50 rounded-2xl text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:bg-bg-secondary/70 transition-all ${inputClassName}`.trim()}
      />
      {datalistId ? (
        <datalist id={datalistId}>
          {suggestions!.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
