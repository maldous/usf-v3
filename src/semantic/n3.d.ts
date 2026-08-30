declare module "n3" {
  export interface Term {
    readonly termType: string;
    readonly value: string;
    readonly language?: string;
    readonly datatype?: Term;
  }

  export interface Quad {
    readonly subject: Term;
    readonly predicate: Term;
    readonly object: Term;
    readonly graph: Term;
  }

  export class Parser {
    constructor(options?: { format?: string; baseIRI?: string });
    parse(input: string): Quad[];
  }

  export class Store implements Iterable<Quad> {
    constructor(quads?: Iterable<Quad> | Quad[]);
    readonly size: number;
    add(quad: Quad): this;
    match(subject?: unknown, predicate?: unknown, object?: unknown, graph?: unknown): Store;
    [Symbol.iterator](): Iterator<Quad>;
  }

  export class Writer {
    constructor(options?: { format?: string });
    addQuads(quads: Iterable<Quad>): void;
    end(callback: (error: Error | null, result: string) => void): void;
  }

  export const DataFactory: {
    namedNode(value: string): Term;
    blankNode(value?: string): Term;
    defaultGraph(): Term;
    quad(subject: Term, predicate: Term, object: Term, graph?: Term): Quad;
  };
}

declare module "rdf-canonize" {
  export function canonize(
    input: string,
    options: {
      algorithm: "RDFC-1.0";
      inputFormat: "application/n-quads";
      maxWorkFactor: number;
      signal?: AbortSignal;
    },
  ): Promise<string>;
}
