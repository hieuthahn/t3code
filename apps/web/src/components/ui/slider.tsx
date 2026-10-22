import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "~/lib/utils";

function Slider({
  className,
  thumbLabel,
  ...props
}: SliderPrimitive.Root.Props<number> & { thumbLabel: string }) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      data-slot="slider"
      {...props}
    >
      <SliderPrimitive.Control className="flex h-6 w-full cursor-pointer items-center data-disabled:cursor-not-allowed data-disabled:opacity-64">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-input">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={thumbLabel}
            className="size-4 rounded-full border border-primary/40 bg-background shadow-sm/10 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
