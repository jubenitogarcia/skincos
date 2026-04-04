type PageTitleBandProps = {
    title: string;
    ariaLabel: string;
};

export default function PageTitleBand({ title, ariaLabel }: PageTitleBandProps) {
    return (
        <section className="heroTitleBand" aria-label={ariaLabel}>
            <div className="container heroTitleBand__inner">
                <span className="heroTitleBand__title">{title}</span>
            </div>
        </section>
    );
}
