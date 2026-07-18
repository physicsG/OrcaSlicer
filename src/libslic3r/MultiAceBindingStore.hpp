#ifndef slic3r_MultiAceBindingStore_hpp_
#define slic3r_MultiAceBindingStore_hpp_

#include <cstddef>
#include <map>
#include <memory>
#include <stdexcept>
#include <utility>

namespace Slic3r::MultiAce {

// Owns one binding per machine and guarantees that replacement and shutdown
// detach the old binding before its machine can be destroyed.
template<class Machine, class Binding> class BasicMultiAceBindingStore
{
public:
    BasicMultiAceBindingStore() = default;
    ~BasicMultiAceBindingStore() noexcept { detach_all(); }

    BasicMultiAceBindingStore(const BasicMultiAceBindingStore&)            = delete;
    BasicMultiAceBindingStore& operator=(const BasicMultiAceBindingStore&) = delete;
    BasicMultiAceBindingStore(BasicMultiAceBindingStore&&)                 = delete;
    BasicMultiAceBindingStore& operator=(BasicMultiAceBindingStore&&)      = delete;

    template<class Factory> Binding& attach(Machine& machine, Factory&& factory)
    {
        detach(machine);

        std::unique_ptr<Binding> binding = std::forward<Factory>(factory)();
        if (!binding)
            throw std::invalid_argument("multiACE machine binding factory returned null");

        auto result = m_bindings.emplace(&machine, std::move(binding));
        return *result.first->second;
    }

    bool detach(Machine& machine) noexcept
    {
        const auto found = m_bindings.find(&machine);
        if (found == m_bindings.end())
            return false;

        std::unique_ptr<Binding> binding = std::move(found->second);
        m_bindings.erase(found);
        detach_safely(*binding);
        return true;
    }

    void detach_all() noexcept
    {
        while (!m_bindings.empty()) {
            auto node = m_bindings.extract(m_bindings.begin());
            detach_safely(*node.mapped());
        }
    }

    Binding* get(Machine& machine) noexcept
    {
        const auto found = m_bindings.find(&machine);
        return found == m_bindings.end() ? nullptr : found->second.get();
    }

    const Binding* get(const Machine& machine) const noexcept
    {
        const auto found = m_bindings.find(&machine);
        return found == m_bindings.end() ? nullptr : found->second.get();
    }

    std::size_t size() const noexcept { return m_bindings.size(); }

private:
    static void detach_safely(Binding& binding) noexcept
    {
        try {
            binding.detach();
        } catch (...) {}
    }

    std::map<const Machine*, std::unique_ptr<Binding>> m_bindings;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceBindingStore_hpp_
