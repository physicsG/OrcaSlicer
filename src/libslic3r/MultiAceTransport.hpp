#ifndef slic3r_MultiAceTransport_hpp_
#define slic3r_MultiAceTransport_hpp_

#include <functional>
#include <string>

namespace Slic3r::MultiAce {

struct TransportResponse
{
    unsigned    status_code = 0;
    std::string body;
    std::string error;

    bool successful() const { return error.empty() && status_code >= 200 && status_code < 300; }
};

class RestTransport
{
public:
    virtual ~RestTransport() = default;

    virtual TransportResponse get(const std::string& path)                           = 0;
    virtual TransportResponse post(const std::string& path, const std::string& body) = 0;
};

class EventTransport
{
public:
    using EventCallback      = std::function<void(const std::string&)>;
    using ConnectionCallback = std::function<void(bool, const std::string&)>;

    virtual ~EventTransport() = default;

    // Implementations must stop invoking callbacks before disconnect() returns.
    virtual void connect(const std::string& path, EventCallback event_callback, ConnectionCallback connection_callback) = 0;
    virtual void disconnect()                                                                                           = 0;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceTransport_hpp_
