import { Result, defineSurface, z } from "@surfaces/kit"

const LIST = "mcp__server__list"

const surface = defineSurface({
  title: "Starter",
  description: "Example surface used to typecheck the kit.",
  tools: [LIST],
})

const Items = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })

function Home() {
  const items = surface.useTool(LIST, {}, Items)
  return (
    <Result query={items}>
      {(data) => (
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.items.map((item) => (
            <li key={item.id} className="p-2">
              {item.name}
            </li>
          ))}
        </ul>
      )}
    </Result>
  )
}

export default surface.pages({ "/": { title: "Items", component: Home } })
