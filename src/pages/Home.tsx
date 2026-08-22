import { Hero } from '../components/Hero'
import { ProofBar } from '../components/ProofBar'
import { Services } from '../components/Services'
import { Approach } from '../components/Approach'
import { CaseStudies } from '../components/CaseStudies'
import { Team } from '../components/Team'
import { Values } from '../components/Values'
import { Contact } from '../components/Contact'

export function Home() {
  return (
    <>
      <Hero />
      <ProofBar />
      <Services />
      <Approach />
      <CaseStudies />
      <Team />
      <Values />
      <Contact />
    </>
  )
}
