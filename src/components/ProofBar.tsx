const PROOF_ITEMS = [
  { text: 'Denver, CO', bold: true, suffix: ' — based' },
  { prefix: 'Serving ', items: ['conservation', 'youth', 'watershed'], suffix: ' orgs' },
  { prefix: 'Strategic consulting ', bold: '+', suffix: ' AI-powered tools' },
  { prefix: 'Field-tested ', bold: '&', suffix: ' community-driven' },
]

export function ProofBar() {
  return (
    <div className="bg-gray-50 border-b border-gray-200 py-5 px-6 lg:px-12">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-center gap-3 md:gap-8">
        {PROOF_ITEMS.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            {i > 0 && <div className="hidden md:block w-px h-6 bg-gray-200" />}
            <span className="text-sm text-gray-500">
              {item.prefix}
              {item.bold && <strong className="font-semibold text-navy">{item.bold}</strong>}
              {item.text && <strong className="font-semibold text-navy">{item.text}</strong>}
              {item.items?.map((sub, j) => (
                <span key={j}>
                  <strong className="font-semibold text-navy">{sub}</strong>
                  {j < item.items!.length - 2 && ', '}
                  {j === item.items!.length - 2 && ', & '}
                </span>
              ))}
              {item.suffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
